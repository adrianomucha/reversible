import type { Diff } from "../../core";

export interface ActionDiffProps {
  diff?: Diff;
}

/** Renders a Diff in human-readable form: summary line plus before/after entries. */
export function ActionDiff({ diff }: ActionDiffProps) {
  if (!diff || (!diff.summary && !diff.entries?.length)) return null;

  return (
    <div className="rev-diff">
      {diff.summary ? <p className="rev-diff-summary">{diff.summary}</p> : null}
      {diff.entries?.length ? (
        <ul className="rev-diff-entries">
          {diff.entries.map((entry, index) => (
            <li key={index} className="rev-diff-entry">
              <span className="rev-diff-label">{entry.label}</span>
              {entry.before !== undefined || entry.after !== undefined ? (
                <span className="rev-diff-change">
                  {entry.before !== undefined ? (
                    <del className="rev-diff-before">{entry.before}</del>
                  ) : null}
                  {entry.before !== undefined && entry.after !== undefined ? (
                    <span className="rev-diff-arrow" aria-hidden="true">
                      {"→"}
                    </span>
                  ) : null}
                  {entry.after !== undefined ? (
                    <ins className="rev-diff-after">{entry.after}</ins>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
