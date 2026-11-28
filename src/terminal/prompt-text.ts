import { stripVTControlCharacters } from 'node:util';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function previousGrapheme(text: string, cursor: number): number {
  return cursor <= 0 ? 0 : graphemes.segment(text).containing(cursor - 1)?.index ?? 0;
}

export function nextGrapheme(text: string, cursor: number): number {
  const segment = graphemes.segment(text).containing(cursor);
  return segment ? segment.index + segment.segment.length : text.length;
}

export function promptBoundary(text: string, cursor: number): number {
  const segment = graphemes.segment(text).containing(cursor);
  return segment && segment.index < cursor ? segment.index + segment.segment.length : cursor;
}

export function normalizePaste(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}
