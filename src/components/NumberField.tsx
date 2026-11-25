import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  /** Only accept whole numbers. */
  integer?: boolean;
};

function parse(text: string, integer: boolean, min = -Infinity): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d*$/.test(t) || t === '.' || t === '-') return null;
  const v = integer ? parseInt(t, 10) : parseFloat(t);
  return Number.isFinite(v) && v >= min ? v : null;
}

/**
 * Numeric text field that lets the user clear it and type freely. The parent only
 * receives parsed, valid numbers (≥ min); an empty or half-typed field keeps the last valid
 * value, and the field shows that value again when it loses focus.
 */
export function NumberField({ value, onChange, integer = false, min, onBlur, ...rest }: Props) {
  const [text, setText] = useState(String(value));

  // Follow external changes (e.g. a preset was picked) unless they match what is typed.
  useEffect(() => {
    setText((cur) => (parse(cur, integer, min) === value ? cur : String(value)));
  }, [value, integer, min]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value, integer, min);
        if (v !== null) onChange(v);
      }}
      onBlur={(e) => {
        if (parse(text, integer, min) === null) setText(String(value));
        onBlur?.(e);
      }}
    />
  );
}
