use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};

declare_id!("2Ckbi1jrknS2q1CY5SXeq1GR2YMRGJsi99AZJiL8WE4g");

// Constants for PDA seeds
const DISCRIMINATOR_SIZE: usize = 8;
pub const DATA_PDA_SEED: &[u8] = b"test-seed";
pub const MINT_SEED: &[u8] = b"mint-seed";

#[program]
pub mod closing_accounts {
    use super::*;

    pub fn enter_lottery(ctx: Context<EnterLottery>) -> Result<()> {
        msg!("Initializing lottery entry...");
        let lottery_entry = &mut ctx.accounts.lottery_entry;
        lottery_entry.timestamp = Clock::get()?.unix_timestamp;
        lottery_entry.user = ctx.accounts.user.key();
        lottery_entry.user_ata = ctx.accounts.user_ata.key();
        lottery_entry.bump = ctx.bumps.lottery_entry;

        msg!("Entry initialized!");
        Ok(())
    }

    pub fn redeem_winnings_insecure(ctx: Context<RedeemWinnings>) -> Result<()> {
        msg!("Calculating winnings");
        let amount = ctx.accounts.lottery_entry.timestamp as u64 * 10;

        msg!("Minting {} tokens in rewards", amount);
        // Using PDA seeds for minting authority
        let auth_bump = ctx.bumps.mint_auth;
        let auth_seeds = &[MINT_SEED, &[auth_bump]];
        let signer = &[&auth_seeds[..]];

        // Minting tokens to user's ATA
        mint_to(ctx.accounts.mint_ctx().with_signer(signer), amount)?;

        msg!("Closing account...");
        let account_to_close = ctx.accounts.lottery_entry.to_account_info();
        let dest_starting_lamports = ctx.accounts.user.lamports();

        // Arithmetic overflow check when transferring lamports
        **ctx.accounts.user.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(account_to_close.lamports())
            .ok_or(error!(MyError::ArithmeticOverflow))?;
        **account_to_close.lamports.borrow_mut() = 0;

        // Zeroing out account data
        let mut data = account_to_close.try_borrow_mut_data()?;
        data.fill(0);

        msg!("Lottery lamports: {}", account_to_close.lamports());
        msg!("Lottery account closed");

        Ok(())
    }

    pub fn redeem_winnings_secure(ctx: Context<RedeemWinningsSecure>) -> Result<()> {
        msg!("Calculating winnings");
        let amount = ctx.accounts.lottery_entry.timestamp as u64 * 10;

        msg!("Minting {} tokens in rewards", amount);
        // Program signer seeds
        let auth_bump = ctx.bumps.mint_auth;
        let auth_seeds = &[MINT_SEED, &[auth_bump]];
        let signer = &[&auth_seeds[..]];

        // Redeem rewards by minting to user
        mint_to(ctx.accounts.mint_ctx().with_signer(signer), amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct EnterLottery<'info> {
    // Initializing lottery entry as a PDA
    #[account(
        init,
        seeds = [DATA_PDA_SEED, user.key().as_ref()],
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
    // Verifying lottery entry PDA and closing it
    #[account(
        mut,
        seeds = [DATA_PDA_SEED, user.key().as_ref()],
        bump
    )]
    pub lottery_entry: Account<'info, LotteryAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    // Ensuring correct user ATA
    #[account(
        mut,
        constraint = user_ata.key() == lottery_entry.user_ata @ MyError::InvalidUserAta
    )]
    pub user_ata: Account<'info, TokenAccount>,
    // Ensuring correct mint for rewards
    #[account(
        mut,
        constraint = reward_mint.key() == user_ata.mint @ MyError::InvalidMint
    )]
    pub reward_mint: Account<'info, Mint>,
    /// CHECKED: Mint authority PDA, checked by seeds constraint
    #[account(
        seeds = [MINT_SEED],
        bump
    )]
    /// CHECKED: This account will not be checked by anchor
    pub mint_auth: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemWinningsSecure<'info> {
    // program expects this account to be initialized
    #[account(
        mut,
        seeds = [DATA_PDA_SEED,user.key.as_ref()],
        bump = lottery_entry.bump,
        close = user
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
        seeds = [MINT_SEED],
        bump
    )]
    pub mint_auth: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct LotteryAccount {
    pub user: Pubkey,
    pub bump: u8,
    pub timestamp: i64,
    pub user_ata: Pubkey,
}

impl<'info> RedeemWinnings<'info> {
    pub fn mint_ctx(&self) -> CpiContext<'_, '_, '_, 'info, MintTo<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            MintTo {
                mint: self.reward_mint.to_account_info(),
                to: self.user_ata.to_account_info(),
                authority: self.mint_auth.to_account_info(),
            },
        )
    }
}

impl<'info> RedeemWinningsSecure<'info> {
    pub fn mint_ctx(&self) -> CpiContext<'_, '_, '_, 'info, MintTo<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            MintTo {
                mint: self.reward_mint.to_account_info(),
                to: self.user_ata.to_account_info(),
                authority: self.mint_auth.to_account_info(),
            },
        )
    }
}

#[error_code]
pub enum MyError {
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invalid user ATA")]
    InvalidUserAta,
    #[msg("Invalid mint")]
    InvalidMint,
}
