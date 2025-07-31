import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      launches: {
        Row: {
          id: string
          token_name: string
          token_symbol: string
          description: string | null
          total_supply: number
          target_allocation: number
          end_time: string
          status: 'active' | 'completed' | 'expired'
          participants: number
          is_launched: boolean
          created_at: string
          updated_at: string
          // New blockchain fields
          token_address: string | null
          chain_id: number
          clearing_price: number | null
          total_raised: number | null
          auction_controller_address: string | null
        }
        Insert: {
          id?: string
          token_name: string
          token_symbol: string
          description?: string | null
          total_supply: number
          target_allocation: number
          end_time: string
          status?: 'active' | 'completed' | 'expired'
          participants?: number
          is_launched?: boolean
          created_at?: string
          updated_at?: string
          // New blockchain fields
          token_address?: string | null
          chain_id?: number
          clearing_price?: number | null
          total_raised?: number | null
          auction_controller_address?: string | null
        }
        Update: {
          id?: string
          token_name?: string
          token_symbol?: string
          description?: string | null
          total_supply?: number
          target_allocation?: number
          end_time?: string
          status?: 'active' | 'completed' | 'expired'
          participants?: number
          is_launched?: boolean
          created_at?: string
          updated_at?: string
          // New blockchain fields
          token_address?: string | null
          chain_id?: number
          clearing_price?: number | null
          total_raised?: number | null
          auction_controller_address?: string | null
        }
      }
      bids: {
        Row: {
          id: string
          launch_id: string
          price: number
          quantity: number
          wallet_address: string | null
          created_at: string
          // New 1inch fields
          order_hash: string | null
          one_inch_order_id: string | null
          order_status: 'pending' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount: number
          tx_hash: string | null
          block_number: number | null
        }
        Insert: {
          id?: string
          launch_id: string
          price: number
          quantity: number
          wallet_address?: string | null
          created_at?: string
          // New 1inch fields
          order_hash?: string | null
          one_inch_order_id?: string | null
          order_status?: 'pending' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount?: number
          tx_hash?: string | null
          block_number?: number | null
        }
        Update: {
          id?: string
          launch_id?: string
          price?: number
          quantity?: number
          wallet_address?: string | null
          created_at?: string
          // New 1inch fields
          order_hash?: string | null
          one_inch_order_id?: string | null
          order_status?: 'pending' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount?: number
          tx_hash?: string | null
          block_number?: number | null
        }
      }
      limit_orders: {
        Row: {
          id: string
          bid_id: string
          order_hash: string
          maker_address: string
          maker_asset: string
          taker_asset: string
          making_amount: string
          taking_amount: string
          salt: string
          expiration: number
          allowed_sender: string | null
          order_data: any
          signature: string | null
          status: 'created' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          bid_id: string
          order_hash: string
          maker_address: string
          maker_asset: string
          taker_asset: string
          making_amount: string
          taking_amount: string
          salt: string
          expiration: number
          allowed_sender?: string | null
          order_data: any
          signature?: string | null
          status?: 'created' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          bid_id?: string
          order_hash?: string
          maker_address?: string
          maker_asset?: string
          taker_asset?: string
          making_amount?: string
          taking_amount?: string
          salt?: string
          expiration?: number
          allowed_sender?: string | null
          order_data?: any
          signature?: string | null
          status?: 'created' | 'active' | 'filled' | 'cancelled' | 'expired'
          filled_amount?: string
          created_at?: string
          updated_at?: string
        }
      }
      auction_settlements: {
        Row: {
          id: string
          launch_id: string
          clearing_price: number
          total_filled_quantity: number
          total_raised_amount: number
          successful_bids_count: number
          settlement_tx_hash: string | null
          settlement_block_number: number | null
          gas_used: number | null
          settled_at: string
          created_at: string
        }
        Insert: {
          id?: string
          launch_id: string
          clearing_price: number
          total_filled_quantity: number
          total_raised_amount: number
          successful_bids_count: number
          settlement_tx_hash?: string | null
          settlement_block_number?: number | null
          gas_used?: number | null
          settled_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          launch_id?: string
          clearing_price?: number
          total_filled_quantity?: number
          total_raised_amount?: number
          successful_bids_count?: number
          settlement_tx_hash?: string | null
          settlement_block_number?: number | null
          gas_used?: number | null
          settled_at?: string
          created_at?: string
        }
      }
    }
    Functions: {
      calculate_clearing_price: {
        Args: {
          p_launch_id: string
          p_target_allocation: number
        }
        Returns: {
          clearing_price: number
          filled_quantity: number
          successful_bids_count: number
        }[]
      }
      increment_participants: {
        Args: {
          launch_id: string
        }
        Returns: void
      }
    }
  }
}