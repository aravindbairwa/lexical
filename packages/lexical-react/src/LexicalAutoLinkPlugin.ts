/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {LinkAttributes} from '@lexical/link';
import type {ElementNode, LexicalEditor, LexicalNode} from 'lexical';

import {
  $createAutoLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  AutoLinkNode,
} from '@lexical/link';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {mergeRegister} from '@lexical/utils';
import {
  $createTextNode,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  TextNode,
} from 'lexical';
import {useEffect} from 'react';
import invariant from 'shared/invariant';
// import LinkPreview from '../../lexical-playground/src/ui/LinkPreview';

type ChangeHandler = (url: string | null, prevUrl: string | null) => void;

type LinkMatcherResult = {
  attributes?: LinkAttributes;
  index: number;
  length: number;
  text: string;
  url: string;
};

export type LinkMatcher = (text: string) => LinkMatcherResult | null;

function findFirstMatch(
  text: string,
  matchers: Array<LinkMatcher>,
): LinkMatcherResult | null {
  for (let i = 0; i < matchers.length; i++) {
    const match = matchers[i](text);

    if (match) {
      return match;
    }
  }

  return null;
}

const PUNCTUATION_OR_SPACE = /[.,;\s]/;

function isSeparator(char: string): boolean {
  return PUNCTUATION_OR_SPACE.test(char);
}

function endsWithSeparator(textContent: string): boolean {
  return isSeparator(textContent[textContent.length - 1]);
}

function startsWithSeparator(textContent: string): boolean {
  return isSeparator(textContent[0]);
}

function isPreviousNodeValid(node: LexicalNode): boolean {
  let previousNode = node.getPreviousSibling();
  if ($isElementNode(previousNode)) {
    previousNode = previousNode.getLastDescendant();
  }
  return (
    previousNode === null ||
    $isLineBreakNode(previousNode) ||
    ($isTextNode(previousNode) &&
      endsWithSeparator(previousNode.getTextContent()))
  );
}

function isNextNodeValid(node: LexicalNode): boolean {
  let nextNode = node.getNextSibling();
  if ($isElementNode(nextNode)) {
    nextNode = nextNode.getFirstDescendant();
  }
  return (
    nextNode === null ||
    $isLineBreakNode(nextNode) ||
    ($isTextNode(nextNode) && startsWithSeparator(nextNode.getTextContent()))
  );
}

function isContentAroundIsValid(
  matchStart: number,
  matchEnd: number,
  text: string,
  node: TextNode,
): boolean {
  const contentBeforeIsValid =
    matchStart > 0
      ? isSeparator(text[matchStart - 1])
      : isPreviousNodeValid(node);
  if (!contentBeforeIsValid) {
    return false;
  }

  const contentAfterIsValid =
    matchEnd < text.length
      ? isSeparator(text[matchEnd])
      : isNextNodeValid(node);
  return contentAfterIsValid;
}

function handleLinkCreation(
  node: TextNode,
  matchers: Array<LinkMatcher>,
  onChange: ChangeHandler,
): void {
  const nodeText = node.getTextContent();
  let text = nodeText;
  let invalidMatchEnd = 0;
  let remainingTextNode = node;
  let match;

  while ((match = findFirstMatch(text, matchers)) && match !== null) {
    const matchStart = match.index;
    const matchLength = match.length;
    const matchEnd = matchStart + matchLength;
    const isValid = isContentAroundIsValid(
      invalidMatchEnd + matchStart,
      invalidMatchEnd + matchEnd,
      nodeText,
      node,
    );

    // let html;
    // eslint-disable-next-line no-console
    // fetch(match.url).then((res) => res.text()).then((data) => console.log(data));
    // fetch(`/api/link-preview?url=${encodeURI(match.url)}`)
    // .then((response) => response.text())
    // .then((preview) => {
    // eslint-disable-next-line no-console
    // console.log(preview);
    // });
    // eslint-disable-next-line no-console
    // console.log(html)

    // const meta = {
    //   description : "Search the world's information...",
    //   domain : 'http://google.com',
    //   image: 'http://google.com/images/srpr/logo9w.png',
    //   site_name: 'Google',
    //   title: 'Google',
    //   type: 'site'
    // }

    // // eslint-disable-next-line no-console
    // fetch(`https://opengraph.io/api/1.1/site/${match.url}`).then(res => console.log(res))

    if (isValid) {
      let linkTextNode;
      if (invalidMatchEnd + matchStart === 0) {
        [linkTextNode, remainingTextNode] = remainingTextNode.splitText(
          invalidMatchEnd + matchLength,
        );
      } else {
        [, linkTextNode, remainingTextNode] = remainingTextNode.splitText(
          invalidMatchEnd + matchStart,
          invalidMatchEnd + matchStart + matchLength,
        );
      }

      //   <div className="LinkPreview__container">
      //   {preview.img && (
      //     <div className="LinkPreview__imageWrapper">
      //       <img
      //         src={preview.image}
      //         alt={preview.title}
      //         className="LinkPreview__image"
      //       />
      //     </div>
      //   )}
      //   {preview.domain && (
      //     <div className="LinkPreview__domain">{preview.domain}</div>
      //   )}
      //   {preview.title && (
      //     <div className="LinkPreview__title">{preview.title}</div>
      //   )}
      //   {preview.description && (
      //     <div className="LinkPreview__description">
      //       {preview.description}
      //     </div>
      //   )}
      // </div>
      // const unflurredDetails = document.createElement('div');
      // unflurredDetails.innerHTML= 'Wooh!'

      // eslint-disable-next-line no-console
      // console.log('attributes',{...match.attributes, ...meta})
      // const linkPreview = unflurredDetails;
      const linkNode = $createAutoLinkNode(match.url, match.attributes);
      const textNode = $createTextNode(match.text);
      textNode.setFormat(linkTextNode.getFormat());
      textNode.setDetail(linkTextNode.getDetail());
      linkNode.append(textNode);
      // linkNode.append(linkPreview)
      linkTextNode.replace(linkNode);
      onChange(match.url, null);
      invalidMatchEnd = 0;
    } else {
      invalidMatchEnd += matchEnd;
    }

    text = text.substring(matchEnd);
  }
}

function handleLinkEdit(
  linkNode: AutoLinkNode,
  matchers: Array<LinkMatcher>,
  onChange: ChangeHandler,
): void {
  // Check children are simple text
  const children = linkNode.getChildren();
  const childrenLength = children.length;
  for (let i = 0; i < childrenLength; i++) {
    const child = children[i];
    if (!$isTextNode(child) || !child.isSimpleText()) {
      replaceWithChildren(linkNode);
      onChange(null, linkNode.getURL());
      return;
    }
  }

  // Check text content fully matches
  const text = linkNode.getTextContent();
  const match = findFirstMatch(text, matchers);
  if (match === null || match.text !== text) {
    replaceWithChildren(linkNode);
    onChange(null, linkNode.getURL());
    return;
  }

  // Check neighbors
  if (!isPreviousNodeValid(linkNode) || !isNextNodeValid(linkNode)) {
    replaceWithChildren(linkNode);
    onChange(null, linkNode.getURL());
    return;
  }

  const url = linkNode.getURL();
  if (url !== match.url) {
    linkNode.setURL(match.url);
    onChange(match.url, url);
  }

  if (match.attributes) {
    const rel = linkNode.getRel();
    if (rel !== match.attributes.rel) {
      linkNode.setRel(match.attributes.rel || null);
      onChange(match.attributes.rel || null, rel);
    }

    const target = linkNode.getTarget();
    if (target !== match.attributes.target) {
      linkNode.setTarget(match.attributes.target || null);
      onChange(match.attributes.target || null, target);
    }
  }
}

// Bad neighbours are edits in neighbor nodes that make AutoLinks incompatible.
// Given the creation preconditions, these can only be simple text nodes.
function handleBadNeighbors(textNode: TextNode, onChange: ChangeHandler): void {
  const previousSibling = textNode.getPreviousSibling();
  const nextSibling = textNode.getNextSibling();
  const text = textNode.getTextContent();

  if ($isAutoLinkNode(previousSibling) && !startsWithSeparator(text)) {
    replaceWithChildren(previousSibling);
    onChange(null, previousSibling.getURL());
  }

  if ($isAutoLinkNode(nextSibling) && !endsWithSeparator(text)) {
    replaceWithChildren(nextSibling);
    onChange(null, nextSibling.getURL());
  }
}

function replaceWithChildren(node: ElementNode): Array<LexicalNode> {
  const children = node.getChildren();
  const childrenLength = children.length;

  for (let j = childrenLength - 1; j >= 0; j--) {
    node.insertAfter(children[j]);
  }

  node.remove();
  return children.map((child) => child.getLatest());
}

function useAutoLink(
  editor: LexicalEditor,
  matchers: Array<LinkMatcher>,
  onChange?: ChangeHandler,
): void {
  useEffect(() => {
    if (!editor.hasNodes([AutoLinkNode])) {
      invariant(
        false,
        'LexicalAutoLinkPlugin: AutoLinkNode not registered on editor',
      );
    }

    const onChangeWrapped = (url: string | null, prevUrl: string | null) => {
      if (onChange) {
        onChange(url, prevUrl);
      }
    };

    return mergeRegister(
      editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
        const parent = textNode.getParentOrThrow();
        if ($isAutoLinkNode(parent)) {
          handleLinkEdit(parent, matchers, onChangeWrapped);
        } else if (!$isLinkNode(parent)) {
          if (textNode.isSimpleText()) {
            handleLinkCreation(textNode, matchers, onChangeWrapped);
          }

          handleBadNeighbors(textNode, onChangeWrapped);
        }
      }),
    );
  }, [editor, matchers, onChange]);
}

export function AutoLinkPlugin({
  matchers,
  onChange,
}: {
  matchers: Array<LinkMatcher>;
  onChange?: ChangeHandler;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useAutoLink(editor, matchers, onChange);

  return null;
}
