'use client';

import { useState } from 'react';
import { Button, Input, Textarea } from '@itqan/ui';
import { EmptyState } from './EmptyState';
import { MessageSquare } from 'lucide-react';

interface Ticket {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export function HelpTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ticket: Ticket = {
      id: String(Date.now()),
      title: title.trim(),
      status: 'مفتوحة',
      createdAt: new Date().toLocaleDateString('ar-EG'),
    };
    setTickets((prev) => [ticket, ...prev]);
    setTitle('');
    setBody('');
    setSelected(ticket.id);
  };

  const current = tickets.find((t) => t.id === selected);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold text-text-primary">تذاكر الدعم الفني</h2>
      </div>
      <p className="text-text-secondary text-sm font-normal">
        هذا النموذج لا يستبدل بيانات التواصل في تذييل الموقع: support@itqan.link — كلية الأزهر للبنات.
      </p>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="surface-card overflow-hidden min-h-[180px] flex flex-col">
          <div className="bg-[#F6EFE3] px-4 py-3 font-heading font-bold text-text-primary">التذاكر</div>
          <div className="flex-1 p-3 space-y-2">
            {tickets.length === 0 ? (
              <p className="text-sm text-text-secondary p-4 text-center">لا توجد تذاكر بعد</p>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={`w-full text-right p-3 rounded-xl cursor-pointer transition-colors ${
                    selected === t.id ? 'bg-brand-primary/10' : 'hover:bg-surface-canvas'
                  }`}
                >
                  <p className="font-medium text-text-primary">{t.title}</p>
                  <p className="text-xs text-text-secondary mt-1">{t.status} • {t.createdAt}</p>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="surface-card overflow-hidden min-h-[180px] flex flex-col">
          <div className="bg-[#F6EFE3] px-4 py-3 font-heading font-bold text-text-primary">
            {current ? current.title : 'إضافة مشكلة جديدة'}
          </div>
          <div className="flex-1 p-4">
            {current ? (
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">الحالة: {current.status}</p>
                <p className="text-text-primary">تم تسجيل التذكرة محلياً في هذه الجلسة للمتابعة.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <Input label="عنوان المشكلة" value={title} onChange={(e) => setTitle(e.target.value)} required />
                <Textarea label="التفاصيل" value={body} onChange={(e) => setBody(e.target.value)} placeholder="صفّي المشكلة باختصار..." />
                <Button type="submit" className="w-full">إرسال التذكرة</Button>
              </form>
            )}
          </div>
        </div>
      </div>
      {tickets.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="لا توجد تذاكر دعم بعد"
          description="أضيفي مشكلة جديدة من النموذج أعلاه. التواصل الرسمي عبر البريد والدعم في تذييل المنصة ما زال متاحاً."
        />
      )}
    </section>
  );
}
