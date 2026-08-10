"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Preço vindo do servidor. Quando muda (ex.: após correção de preço), o campo reflete o novo valor. */
  price: number;
  title?: string;
  onCommit: (value: number) => void;
};

/**
 * Campo de preço controlado: mantém o que o usuário digita, mas re-sincroniza
 * quando o preço do servidor muda. Com `defaultValue` o input ficava preso ao
 * valor inicial e só atualizava recarregando a página.
 */
export default function PriceInput({ price, title, onCommit }: Props) {
  const [value, setValue] = useState(String(price));

  useEffect(() => {
    setValue(String(price));
  }, [price]);

  return (
    <input
      type="number"
      value={value}
      style={{ width: 90 }}
      title={title}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = Number(value);
        if (next > 0 && next !== price) onCommit(next);
        else setValue(String(price));
      }}
    />
  );
}
