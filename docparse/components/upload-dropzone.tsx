"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api, validateUpload } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { DocParseApi } from "@/lib/api/client";
import type { ParseResponse } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface Props {
  onUploaded?: (res: ParseResponse, file: File) => void;
  client?: Pick<DocParseApi, "parse">;
  disabled?: boolean;
}

export function UploadDropzone({ onUploaded, client = api, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (!files.length) return;
      const errs: string[] = [];
      const valid = files.filter((f) => {
        const err = validateUpload(f);
        if (err) errs.push(err);
        return !err;
      });
      setErrors(errs);
      setBusy((n) => n + valid.length);
      await Promise.all(
        valid.map(async (file) => {
          try {
            const res = await client.parse(file);
            onUploaded?.(res, file);
          } catch (e) {
            setErrors((prev) => [...prev, `${file.name}: ${errorMessage(e)}`]);
          } finally {
            setBusy((n) => n - 1);
          }
        }),
      );
    },
    [client, onUploaded],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload invoices or receipts"
        data-dragging={dragging || undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "border-primary bg-primary/5" : "hover:border-primary/60 hover:bg-muted/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {busy > 0 ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
        </div>
        <div>
          <p className="font-medium">
            {busy > 0 ? `Uploading ${busy} file${busy > 1 ? "s" : ""}…` : "Drop invoices or receipts here"}
          </p>
          <p className="text-sm text-muted-foreground">or click to browse. PDF, PNG, JPG, WEBP up to 20 MB.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          data-testid="file-input"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 text-sm text-destructive">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
