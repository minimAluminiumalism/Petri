import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { useState, type ReactNode } from "react";
import * as RSelect from "@radix-ui/react-select";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, ChevronDown } from "lucide-react";

export const tbl = "w-full border-collapse text-[13.5px] bg-panel rounded-[10px] overflow-hidden border border-border";
export const th = "text-left text-dim font-medium px-3.5 py-2.5 border-b border-border text-xs bg-panel2";
export const td = "px-3.5 py-2.5 border-b border-border align-top";
export const btn = "inline-flex items-center gap-1.5 border border-border rounded-lg bg-panel px-3 py-1.5 text-[13px] cursor-pointer hover:bg-panel2";
export const btnPrimary = "inline-flex items-center gap-1.5 bg-accent border border-accent rounded-lg text-white px-3.5 py-1.5 text-[13px] font-medium cursor-pointer hover:brightness-105";
export const btnDanger = "inline-flex items-center gap-1.5 bg-red border border-red rounded-lg text-white px-3.5 py-1.5 text-[13px] font-medium cursor-pointer hover:brightness-105";
export const input = "bg-panel border border-border rounded-lg px-2.5 py-1.5 text-[13px] text-text";
export const iconBtn = "inline-flex items-center justify-center w-[26px] h-[26px] rounded-md text-dim cursor-pointer hover:text-text hover:bg-panel2";
export const chip = "inline-block font-mono text-[11px] px-2 py-px rounded-[10px] mr-1.5 border border-border text-dim";
export const statusCls = (s: string) =>
  clsx("text-[11px] px-2 py-0.5 rounded-[10px] font-mono", {
    "text-green bg-green-bg": s === "done",
    "text-accent bg-accent-soft": s === "running" || s === "pending",
    "text-amber bg-amber-bg": s === "stopped",
    "text-red bg-red-bg": s === "failed",
  });
export const flagChipCls = (on: boolean) =>
  clsx(chip, on && "text-green bg-green-bg border-transparent");
export const diffChipCls = (added: boolean) =>
  clsx(chip, "border-transparent", added ? "text-green bg-green-bg" : "text-red bg-red-bg");

export function Dialog({ title, children, footer, onClose }: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <AlertDialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-panel border border-border rounded-[10px] p-4 w-[380px] max-w-[90vw] shadow-2xl">
          <AlertDialog.Title className="text-[14px] font-medium mb-1.5">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="text-[13px] text-dim">{children}</div>
          </AlertDialog.Description>
          {footer && <div className="flex justify-end gap-2 mt-4">{footer}</div>}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export interface SelectOption {
  value: string;
  label: ReactNode;
}

const EMPTY_VALUE = "__petri_empty__";

export function Select({ value, options, onChange, placeholder, disabled, mono, className }: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const enc = (v: string) => (v === "" ? EMPTY_VALUE : v);
  const known = options.some((o) => o.value === value);
  return (
    <RSelect.Root
      value={known ? enc(value) : undefined}
      onValueChange={(v) => onChange(v === EMPTY_VALUE ? "" : v)}
      disabled={disabled}
    >
      <RSelect.Trigger className={twMerge(clsx(input, "w-full flex items-center justify-between gap-2 text-left cursor-pointer outline-none data-[disabled]:opacity-50", mono && "font-mono"), className)}>
        <RSelect.Value placeholder={<span className="text-dim">{placeholder ?? "select…"}</span>} />
        <RSelect.Icon><ChevronDown size={13} className="text-dim shrink-0" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-64 min-w-[var(--radix-select-trigger-width)] max-w-[560px] overflow-hidden bg-panel border border-border rounded-lg shadow-2xl"
        >
          <RSelect.Viewport className="py-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={enc(o.value)}
                className={clsx("flex items-center gap-2 w-full px-2.5 py-1.5 text-[13px] text-left cursor-pointer outline-none text-text data-[highlighted]:bg-panel2 data-[state=checked]:text-accent", mono && "font-mono")}
              >
                <span className="w-3 shrink-0"><RSelect.ItemIndicator><Check size={12} /></RSelect.ItemIndicator></span>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function useConfirm() {
  const [req, setReq] = useState<{ title: string; body: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = (title: string, body: string) =>
    new Promise<boolean>((resolve) => setReq({ title, body, resolve }));
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  const confirmEl = req && (
    <Dialog
      title={req.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className={btn} onClick={() => done(false)}>Cancel</button>
          <button className={btnDanger} onClick={() => done(true)}>Delete</button>
        </>
      }
    >
      {req.body}
    </Dialog>
  );
  return { confirm, confirmEl };
}
