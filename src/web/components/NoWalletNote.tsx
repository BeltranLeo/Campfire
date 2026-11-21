import { Link } from 'react-router';
import { useMessages } from '../lang';

// Under a "Connect wallet to …" button: without a wallet the button only connects, so the note gives a way out to
// someone who has none yet, instead of naming the pairing protocol.
function NoWalletNote() {
  const t = useMessages().common;
  return (
    <>
      {t.noWallet} <Link to="/welcome">{t.getOneFirst}</Link>
    </>
  );
}

export const noWalletNote = <NoWalletNote />;
