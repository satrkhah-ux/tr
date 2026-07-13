import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
};

/** Designed empty state (handoff section 6.3). */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-5 py-16 text-center ${className ?? ""}`}>
      <div className="mb-[18px] flex size-[76px] items-center justify-center rounded-[20px] bg-[#eff5f2] text-[#a9c3ba]">
        <Icon className="size-[34px]" strokeWidth={1.9} />
      </div>
      <div className="text-[17px] font-extrabold text-[#003c3a]">{title}</div>
      {description ? (
        <div className="mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-[#8aa29b]">{description}</div>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-[18px] h-[42px] rounded-[10px] bg-[#185045] px-[22px] text-[13.5px] font-bold text-white transition-colors hover:bg-[#0f4439]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
