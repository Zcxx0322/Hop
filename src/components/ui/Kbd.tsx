import type { ReactNode } from 'react';
import './Kbd.css';

/** 键帽：用于展示快捷键。 */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function KbdGroup({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-group">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}
