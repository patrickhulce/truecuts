"use client";

import type { SceneComponent, SceneModel } from "@/lib/scene";
import { formatInches } from "@/lib/units";

type ComponentsBrowserProps = {
  scene?: SceneModel;
  selectedKeys: string[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onSelectKeys: (keys: string[]) => void;
  onSelect: (key: string | null, options?: { shift?: boolean }) => void;
};

function componentFullySelected(component: SceneComponent, selectedKeys: string[]): boolean {
  if (component.members.length === 0 || component.members.length !== selectedKeys.length) return false;
  const selected = new Set(selectedKeys);
  return component.members.every((member) => selected.has(member.key));
}

function formatFinished(finished: SceneComponent["members"][number]["finished"]): string {
  return `${formatInches(finished.length)} × ${formatInches(finished.width)} × ${formatInches(finished.thickness)}`;
}

export function ComponentsBrowser({
  scene,
  selectedKeys,
  openId,
  onOpen,
  onSelectKeys,
  onSelect,
}: ComponentsBrowserProps) {
  if (!scene) {
    return (
      <div className="flex min-h-0 flex-1 items-start px-4 py-6 text-sm text-[#a89070]">
        Fix YAML to browse components.
      </div>
    );
  }

  const open = scene.components.find((component) => component.id === openId) ?? null;
  if (open) {
    return (
      <ComponentDetail
        component={open}
        onBack={() => onOpen(null)}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto pb-6">
      {scene.components.length === 0 ? (
        <p className="px-3 py-4 text-xs text-[#8a7355]">No components</p>
      ) : (
        <ul>
          {scene.components.map((component) => {
            const selected = componentFullySelected(component, selectedKeys);
            const count = component.members.length;
            return (
              <li key={component.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onOpen(component.id);
                    onSelectKeys(component.members.map((member) => member.key));
                  }}
                  className={`flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[#2a1d12] ${
                    selected ? "bg-[#3d2a18]" : ""
                  }`}
                >
                  <span className="text-sm text-[#d6c3a3]">{component.label}</span>
                  <span className="text-[11px] text-[#8a7355]">
                    {component.id} · {count} {count === 1 ? "member" : "members"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ComponentDetail({
  component,
  onBack,
  onSelect,
}: {
  component: SceneComponent;
  onBack: () => void;
  onSelect: (key: string | null, options?: { shift?: boolean }) => void;
}) {
  const count = component.members.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 border-b border-[#3d2a18] bg-[#1a120b] px-3 py-2">
          <button
            type="button"
            onClick={onBack}
            className="cursor-pointer text-xs text-[#a89070] hover:text-[#f59e0b]"
          >
            ← All components
          </button>
        </div>
        <div className="py-3">
          <div className="px-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[#f59e0b]">{component.label}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[#a89070]">
              <dt>id</dt>
              <dd className="text-[#d6c3a3]">{component.id}</dd>
              <dt>members</dt>
              <dd className="text-[#d6c3a3]">{count}</dd>
            </dl>
          </div>
          <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest text-[#8a7355]">Members</div>
          {count === 0 ? (
            <p className="px-3 text-xs text-[#8a7355]">No members</p>
          ) : (
            <ul>
              {component.members.map((part) => (
                <li key={part.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(part.key)}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-[#2a1d12]"
                  >
                    <span className="text-sm text-[#d6c3a3]">{part.label}</span>
                    <span className="text-[11px] text-[#8a7355]">
                      {part.memberId} · {part.stockLabel} · {formatFinished(part.finished)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
