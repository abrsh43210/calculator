import { COMPETITORS, formatUsd } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function Comparison() {
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Entry-plan pricing compared with other invoice parsers</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Plan</th>
            <th scope="col" className="px-4 py-3 font-medium">Price / month</th>
            <th scope="col" className="px-4 py-3 font-medium">Documents</th>
            <th scope="col" className="px-4 py-3 font-medium">Per document</th>
            <th scope="col" className="px-4 py-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {COMPETITORS.map((c) => (
            <tr key={c.name} className={cn("us" in c && c.us && "bg-primary/5 font-medium")}>
              <th scope="row" className="px-4 py-3 font-medium">{c.name}</th>
              <td className="px-4 py-3">{formatUsd(c.price)}</td>
              <td className="px-4 py-3">{c.docs === null ? "By usage" : c.docs.toLocaleString("en-US")}</td>
              <td className="px-4 py-3">{c.docs === null ? "From $0.08" : formatUsd(c.price / c.docs)}</td>
              <td className="px-4 py-3 text-muted-foreground">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Competitor prices are list prices from their public pricing pages, November 2026.
      </p>
    </div>
  );
}
