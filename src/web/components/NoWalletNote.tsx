import { Link } from 'react-router';

// Under a "Connect wallet to …" button: without a wallet the button only connects, so the note gives a way out to
// someone who has none yet, instead of naming the pairing protocol.
export const noWalletNote = (
  <>
    No wallet yet? Your BCH goes to your own wallet. <Link to="/welcome">Get one first</Link>
  </>
);
