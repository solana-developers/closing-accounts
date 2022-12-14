import * as anchor from "@project-serum/anchor"
import { Program } from "@project-serum/anchor"
import { ClosingAccounts } from "../target/types/closing_accounts"
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import { safeAirdrop } from "./utils/utils"
import { expect } from 'chai'

describe("closing-accounts", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())
  const provider = anchor.AnchorProvider.env()
  const program = anchor.workspace.ClosingAccounts as Program<ClosingAccounts>
  const authority = Keypair.generate()

  it("Initialize and Close Data Account", async () => {
    // Add your test here.
    const [dataAccount, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("test-seed"), authority.publicKey.toBuffer()],
      program.programId
    )
    await safeAirdrop(authority.publicKey, provider.connection)

    // tx to initialize the data account
    await program.methods.initialize()
    .accounts({
      dataAccount: dataAccount,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId
    })
    .signers([authority])
    .rpc()

    const tx = new Transaction()
    // instruction attempts to close the account
    const ix1 = await program.methods.closeAcct()
    .accounts({
      dataAccount: dataAccount,
      receiver: authority.publicKey
    })
    .instruction()
    tx.add(ix1)

    // malicious user adds instruction to refund dataAccount lamports
    const maliciousAttacker = Keypair.generate()
    await safeAirdrop(maliciousAttacker.publicKey, provider.connection)
    const rentExemptLamports = await provider.connection.getMinimumBalanceForRentExemption(16, "confirmed")
    tx.add(
      SystemProgram.transfer({
          fromPubkey: maliciousAttacker.publicKey,
          toPubkey: dataAccount,
          lamports: rentExemptLamports,
      })
    )

    // tx is sent
    const txSig = await provider.connection.sendTransaction(tx, [authority, maliciousAttacker])
    await provider.connection.confirmTransaction(txSig)

    // try to fetch account data
    try {
      const closedAcct = await program.account.dataAccount.fetch(dataAccount)
      console.log("Account data:", closedAcct.data)
    } catch (e) {
      console.log(e.message)
      expect(e.message).to.eq("Invalid account discriminator")
    }

    // malicious user tries to use account
    try {
      await program.methods.doSomething()
      .accounts({
        dataAccount: dataAccount,
      })
      .rpc()
    }
    catch (e) {
      console.log(e.message)
      expect(e.message).to.eq("AnchorError caused by account: data_account. Error Code: AccountDiscriminatorMismatch. Error Number: 3002. Error Message: 8 byte discriminator did not match what was expected.")
    }

    // force defund the account
    const defundTx = await program.methods.forceDefund()
    .accounts({
      dataAccount: dataAccount,
      destination: authority.publicKey
    })
    .rpc()
    await provider.connection.confirmTransaction(defundTx)

    // try to fetch account data, but it should be closed now
    try {
      const closedAcct = await program.account.dataAccount.fetch(dataAccount)
      console.log("Account data:", closedAcct.data)
    } catch (e) {
      console.log(e.message)
      expect(e.message).to.eq(`Account does not exist ${dataAccount.toBase58()}`)
    }
  })
})
