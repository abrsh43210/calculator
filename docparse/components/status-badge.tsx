import { CheckCircle2, CircleAlert, Loader2, Clock } from "lucide-react";
import type { DocumentStatus } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";

const map = {
  completed: { label: "Completed", variant: "success", Icon: CheckCircle2 },
  processing: { label: "Processing", variant: "default", Icon: Loader2 },
  queued: { label: "Queued", variant: "outline", Icon: Clock },
  failed: { label: "Failed", variant: "destructive", Icon: CircleAlert },
} as const;

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { label, variant, Icon } = map[status];
  return (
    <Badge variant={variant}>
      <Icon className={`size-3 ${status === "processing" ? "animate-spin" : ""}`} aria-hidden />
      {label}
    </Badge>
  );
}
