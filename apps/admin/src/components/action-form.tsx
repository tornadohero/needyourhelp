'use client';

import { useState } from 'react';

import type { ActionResult } from '../lib/actions';

/**
 * One form component for every operator command (T033).
 *
 * It owns nothing but what the operator typed: the command itself runs as a
 * server action, with the session token staying on the server. A refusal is
 * shown as the platform's own sentence — the console never renders a stack
 * trace, and a command that changes money or a status always asks for a reason
 * first (`specs/12-admin-spec.md`).
 */
export interface ActionField {
  name: 'text' | 'extra' | 'name';
  label: string;
  type?: 'text' | 'password' | 'number';
  options?: string[];
}

export function ActionForm({
  action,
  kind,
  id,
  fields = [],
  submitLabel,
  confirm,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  kind: string;
  id?: string;
  fields?: ActionField[];
  submitLabel: string;
  /** Shown before submitting: for decisions that cannot be undone. */
  confirm?: string;
}) {
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  return (
    <form
      className="inline"
      action={async (formData: FormData) => {
        formData.set('kind', kind);
        if (id !== undefined) {
          formData.set('id', id);
        }
        if (confirm !== undefined && !window.confirm(confirm)) {
          return;
        }
        const result = await action(formData);
        setMessage(result.message);
        setFailed(!result.ok);
      }}
    >
      {fields.map((field) =>
        field.options === undefined ? (
          <input
            key={field.name}
            name={field.name}
            type={field.type ?? 'text'}
            placeholder={field.label}
          />
        ) : (
          <select key={field.name} name={field.name}>
            {field.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ),
      )}
      <button type="submit">{submitLabel}</button>
      {message.length > 0 ? <span className={failed ? 'error' : undefined}>{message}</span> : null}
    </form>
  );
}
