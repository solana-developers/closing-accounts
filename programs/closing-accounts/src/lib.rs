use anchor_lang::prelude::*;
use anchor_lang::__private::CLOSED_ACCOUNT_DISCRIMINATOR;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod closing_accounts {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.data_account.data = 1;
        msg!("Account data initialized: {}", ctx.accounts.data_account.data);
        Ok(())
    }

    pub fn close_acct(ctx: Context<Close>) -> Result<()> {
        msg!("Account closed!");
        msg!("Data account data: {}", ctx.accounts.data_account.data);
        Ok(())
    }

    pub fn do_something(ctx: Context<Update>) -> Result<()> {
        // update data account
        ctx.accounts.data_account.data = 5;
        msg!("Updated data: {}", ctx.accounts.data_account.data);
        Ok(())
    }

    pub fn force_defund(ctx: Context<ForceDefund>) -> Result<()> {
        let account = &ctx.accounts.data_account;

        let data = account.try_borrow_data()?;
        assert!(data.len() > 8);

        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&data[0..8]);
        if discriminator != CLOSED_ACCOUNT_DISCRIMINATOR {
            return err!(MyError::InvalidDiscriminator);
        }

        let dest_starting_lamports = ctx.accounts.destination.lamports();

        **ctx.accounts.destination.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(account.lamports())
            .unwrap();
        **account.lamports.borrow_mut() = 0;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 8,
        // pda associated with user
        seeds = [DATA_PDA_SEED.as_bytes(), authority.key().as_ref()],
        bump
    )]
    pub data_account: Account<'info, DataAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = receiver,)]
    pub data_account: Account<'info, DataAccount>,
    ///CHECK: Safe
    pub receiver: AccountInfo<'info>
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut)]
    pub data_account: Account<'info, DataAccount>,
}

#[derive(Accounts)]
pub struct ForceDefund<'info> {
    ///CHECK: safe
    #[account(mut)]
    data_account: AccountInfo<'info>,
    ///CHECK: safe
    #[account(mut)]
    destination: AccountInfo<'info>,
}

#[account]
pub struct DataAccount {
    data: u64
}

pub const DATA_PDA_SEED: &str = "test-seed";

#[error_code]
pub enum MyError {
    #[msg("Expected closed account discriminator")]
    InvalidDiscriminator
}