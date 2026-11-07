import { useEffect } from 'react';
import {
  Box, X,
} from 'lucide-react';

export function Logo({ compact = false }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}>
    <div className="brand-cube"><span>H</span><i /></div>
    {!compact && <div className="brand-type"><strong>HCL</strong><small>MINECRAFT LAUNCHER</small></div>}
  </div>;
}

export function IconButton({ children, title, className = '', ...props }) {
  return <button className={`icon-button ${className}`} title={title} {...props}>{children}</button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }) {
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`}>
      <header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭" onClick={onClose}><X size={19} /></IconButton></header>
      {children}
    </section>
  </div>;
}

export function EmptyState({ icon: Icon = Box, title, text, action, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={28} /></div><h3>{title}</h3><p>{text}</p>{action && <button className="button secondary" onClick={onAction}>{action}</button>}</div>;
}
