use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};
use std::ops::DerefMut;

declare_id!("FqETzdh6PsE7aNjrdapuoyFeYGdjPKN8AgG2ZUghje8A");

const DISCRIMINATOR_SIZE: usize = 8;
pub const DATA_PDA_SEED: &str = "test-seed";
pub const MINT_SEED: &str = "mint-seed";

#[program]
pub mod closing_accounts {

    use super::*;

    pub fn enter_lottery(ctx: Context<EnterLottery>) -> Result<()> {
        msg!("Initializing lottery entry...");
        ctx.accounts.lottery_entry.timestamp = Clock::get().unwrap().unix_timestamp;
        ctx.accounts.lottery_entry.user = ctx.accounts.user.key();
        ctx.accounts.lottery_entry.user_ata = ctx.accounts.user_ata.key();
        ctx.accounts.lottery_entry.bump = ctx.bumps.lottery_entry;

        msg!("Entry initialized!");

        Ok(())
    }

    pub fn redeem_winnings_insecure(ctx: Context<RedeemWinnings>) -> Result<()> {
        msg!("Calculating winnings");

        let amount = ctx.accounts.lottery_entry.timestamp as u64 * 10;

        msg!("Minting {} tokens in rewards", amount);
        // program signer seeds
        let auth_bump = ctx.bumps.mint_auth;
        let auth_seeds = &[MINT_SEED.as_bytes(), &[auth_bump]];
        let signer = &[&auth_seeds[..]];

        // donate RND by minting to vault
        mint_to(ctx.accounts.mint_ctx().with_signer(signer), amount)?;

        msg!("Closing account...");
        let account_to_close = ctx.accounts.lottery_entry.to_account_info();
        let dest_starting_lamports = ctx.accounts.user.lamports();

        **ctx.accounts.user.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(account_to_close.lamports())
            .unwrap();
        **account_to_close.lamports.borrow_mut() = 0;

        let mut data = account_to_close.try_borrow_mut_data()?;
        for byte in data.deref_mut().iter_mut() {
            *byte = 0;
        }

        msg!("Lottery lamports: {:?}", account_to_close.lamports);
        msg!("Lottery account closed");

        Ok(())
    }
}

#[derive(Accounts)]
pub struct EnterLottery<'info> {
    #[account(
        init,
        seeds = [DATA_PDA_SEED.as_bytes(),user.key.as_ref()],
        bump,
        payer = user,
        space = DISCRIMINATOR_SIZE + LotteryAccount::INIT_SPACE
    )]
    pub lottery_entry: Account<'info, LotteryAccount>,
    pub user_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemWinnings<'info> {
    // program expects this account to be initialized
    #[account(
        mut,
        seeds = [DATA_PDA_SEED.as_bytes(),user.key.as_ref()],
        bump
    )]
    pub lottery_entry: Account<'info, LotteryAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_ata.key() == lottery_entry.user_ata
    )]
    pub user_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = reward_mint.key() == user_ata.mint
    )]
    pub reward_mint: Account<'info, Mint>,
    ///CHECK: mint authority
    #[account(
        seeds = [MINT_SEED.as_bytes()],
        bump
    )]
    pub mint_auth: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct LotteryAccount {
    is_initialized: bool,
    user: Pubkey,
    bump: u8,
    timestamp: i64,
    user_ata: Pubkey,
}

impl<'info> RedeemWinnings<'info> {
    pub fn mint_ctx(&self) -> CpiContext<'_, '_, '_, 'info, MintTo<'info>> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = MintTo {
            mint: self.reward_mint.to_account_info(),
            to: self.user_ata.to_account_info(),
            authority: self.mint_auth.to_account_info(),
        };

        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[error_code]
pub enum MyError {
    #[msg("Expected closed account discriminator")]
    InvalidDiscriminator,
}
