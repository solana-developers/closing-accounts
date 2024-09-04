import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

export async function safeAirdrop(address: PublicKey, connection: Connection) {
  const acctInfo = await connection.getAccountInfo(address, "confirmed");

  if (acctInfo == null || acctInfo.lamports < LAMPORTS_PER_SOL) {
    const airdropSignature = await connection.requestAirdrop(
      address,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );

    const latestBlockHash = await connection.getLatestBlockhash();

    await connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: airdropSignature,
      },
      "confirmed"
    );
  }
}
