import { Fragment, type ReactNode } from 'react';

const MARK = '\u0001';

/**
 * Splice a React node into a translated string at its `{slot}` placeholder so the
 * whole sentence stays one translatable unit (translate with SLOT as the param value, then slot the node in).
 */
export const SLOT = MARK;
export function slotted(text: string, node: ReactNode): ReactNode {
  const parts = text.split(MARK);
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 ? node : null}
    </Fragment>
  ));
}
