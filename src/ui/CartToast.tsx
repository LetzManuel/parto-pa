import { useEffect, useState } from 'react';
import { finishGurkerlLogin, onCartEvent } from '../platform/gurkerl';
import { speak } from '../platform/speech';
import { usePA } from './context';

/** Progress and result of a gurkerl cart fill, wherever the person is in the app. Read out once at the end. */
export function CartToast() {
  const { store, refresh } = usePA();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    finishGurkerlLogin(store).then((ok) => { if (ok) { setText('gurkerl verbunden. Ab jetzt befüllt PA den Warenkorb.'); refresh(); } })
      .catch(() => setText('gurkerl-Anmeldung hat nicht geklappt. Bitte nochmal unter Ich › Einkauf & Bestellen.'));
    let n = 0;
    return onCartEvent((e) => {
      if (e.phase === 'start') { n = 0; setText(`Lege „${e.list}“ in den gurkerl-Warenkorb …`); }
      if (e.phase === 'line') { n++; setText(`Im gurkerl-Warenkorb: ${n} …`); }
      if (e.phase === 'done') { const t = `${e.summary} In gurkerl einmal aktualisieren.`; setText(t); void speak(e.summary); }
      if (e.phase === 'error') { setText(e.message); void speak(e.message); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  if (!text) return null;
  return (
    <div className="toast" role="status" onClick={() => setText(null)}>{text}</div>
  );
}
