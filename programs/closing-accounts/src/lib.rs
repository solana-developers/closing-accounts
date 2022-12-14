use anchor_lang::prelude::*;
use anchor_lang::__private::CLOSED_ACCOUNT_DISCRIMINATOR;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod closing_accounts {
    use super::*;

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