import { parseStack, groupStack, type StackItem } from "@/lib/stack";
import { Meta } from "@/components/ui/primitives";

/**
 * "Built with", organised. Grouped front end / back end / data / hosting so
 * it reads as an answer rather than a sentence, with a drawn mark per item.
 * Marks are inline SVG: a client shelf must not fetch an asset from anyone.
 */
function Mark({ item }: { item: StackItem }) {
  if (!item.mark) {
    return (
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-[2px] bg-line font-display text-[11px] text-muted"
      >
        {item.name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-5 shrink-0"
      fill={item.filled ? "currentColor" : "none"}
      stroke={item.filled ? "none" : "currentColor"}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={item.mark} />
    </svg>
  );
}

export default function StackList({
  stack,
  className,
}: {
  stack: string | null | undefined;
  className?: string;
}) {
  const groups = groupStack(parseStack(stack));
  if (groups.length === 0) return null;

  return (
    <div className={className}>
      <dl className="flex flex-col gap-4">
        {groups.map(([category, items]) => (
          <div key={category} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <dt className="sm:w-[86px] sm:shrink-0 sm:pt-[3px]">
              <Meta>{category}</Meta>
            </dt>
            <dd className="flex flex-wrap gap-x-2 gap-y-2">
              {items.map((item) => (
                <span
                  key={item.name}
                  className="inline-flex items-center gap-2 rounded-md border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink"
                >
                  <span className="text-muted">
                    <Mark item={item} />
                  </span>
                  {item.name}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
