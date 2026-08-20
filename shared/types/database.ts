// Generated from the Supabase project "POS" (uxdomhpxhcvaqqpryloq).
// Regenerate after a migration; do not hand-edit.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
      employees: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount_centavos: number
          created_at: string
          created_by: string | null
          created_by_email: string | null
          description: string | null
          id: string
          name: string
          spent_on: string
          updated_at: string
        }
        Insert: {
          amount_centavos: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          description?: string | null
          id?: string
          name: string
          spent_on?: string
          updated_at?: string
        }
        Update: {
          amount_centavos?: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          description?: string | null
          id?: string
          name?: string
          spent_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      inclusion_options: {
        Row: {
          created_at: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      package_inclusions: {
        Row: {
          created_at: string
          id: string
          label: string
          service_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          service_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          service_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: 'package_inclusions_service_id_fkey'
            columns: ['service_id']
            isOneToOne: false
            referencedRelation: 'services'
            referencedColumns: ['id']
          },
        ]
      }
      payroll_adjustments: {
        Row: {
          amount_centavos: number
          created_at: string
          created_by: string | null
          created_by_email: string | null
          employee_id: string
          id: string
          reason: string
          updated_at: string
          week_start: string
        }
        Insert: {
          amount_centavos: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          employee_id: string
          id?: string
          reason: string
          updated_at?: string
          week_start: string
        }
        Update: {
          amount_centavos?: number
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          employee_id?: string
          id?: string
          reason?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payroll_adjustments_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          finalized_at: string | null
          id: string
          status: Database['public']['Enums']['payroll_status']
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          finalized_at?: string | null
          id?: string
          status?: Database['public']['Enums']['payroll_status']
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          finalized_at?: string | null
          id?: string
          status?: Database['public']['Enums']['payroll_status']
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      payroll_slips: {
        Row: {
          adjustment_centavos: number
          commission_centavos: number
          employee_id: string
          employee_name: string
          finalized_at: string
          gross_sales_centavos: number
          id: string
          period_id: string
          sales_count: number
        }
        Insert: {
          adjustment_centavos?: number
          commission_centavos?: number
          employee_id: string
          employee_name: string
          finalized_at?: string
          gross_sales_centavos?: number
          id?: string
          period_id: string
          sales_count?: number
        }
        Update: {
          adjustment_centavos?: number
          commission_centavos?: number
          employee_id?: string
          employee_name?: string
          finalized_at?: string
          gross_sales_centavos?: number
          id?: string
          period_id?: string
          sales_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'payroll_slips_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payroll_slips_period_id_fkey'
            columns: ['period_id']
            isOneToOne: false
            referencedRelation: 'payroll_periods'
            referencedColumns: ['id']
          },
        ]
      }
      sale_item_commissions: {
        Row: {
          commission_centavos: number
          created_at: string
          crew_size: number
          employee_id: string
          id: string
          sale_id: string
          sale_item_id: string
        }
        Insert: {
          commission_centavos: number
          created_at?: string
          crew_size: number
          employee_id: string
          id?: string
          sale_id: string
          sale_item_id: string
        }
        Update: {
          commission_centavos?: number
          created_at?: string
          crew_size?: number
          employee_id?: string
          id?: string
          sale_id?: string
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sale_item_commissions_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sale_item_commissions_sale_id_fkey'
            columns: ['sale_id']
            isOneToOne: false
            referencedRelation: 'sales'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sale_item_commissions_sale_item_id_fkey'
            columns: ['sale_item_id']
            isOneToOne: false
            referencedRelation: 'sale_items'
            referencedColumns: ['id']
          },
        ]
      }
      sale_items: {
        Row: {
          category: Database['public']['Enums']['service_category']
          commission_centavos: number
          commission_rate_bp: number
          created_at: string
          employee_id: string
          id: string
          line_total_centavos: number
          quantity: number
          sale_id: string
          service_id: string | null
          service_name: string
          size: string
          status: Database['public']['Enums']['service_status']
          status_changed_at: string | null
          status_changed_by: string | null
          effective_total_centavos: number
          effective_commission_centavos: number
          unit_price_centavos: number
        }
        Insert: {
          category: Database['public']['Enums']['service_category']
          commission_centavos: number
          commission_rate_bp: number
          created_at?: string
          employee_id: string
          id?: string
          line_total_centavos: number
          quantity?: number
          sale_id: string
          service_id?: string | null
          service_name: string
          size: string
          status?: Database['public']['Enums']['service_status']
          status_changed_at?: string | null
          status_changed_by?: string | null
          unit_price_centavos: number
        }
        Update: {
          category?: Database['public']['Enums']['service_category']
          commission_centavos?: number
          commission_rate_bp?: number
          created_at?: string
          employee_id?: string
          id?: string
          line_total_centavos?: number
          quantity?: number
          sale_id?: string
          service_id?: string | null
          service_name?: string
          size?: string
          status?: Database['public']['Enums']['service_status']
          status_changed_at?: string | null
          status_changed_by?: string | null
          unit_price_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: 'sale_items_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sale_items_sale_id_fkey'
            columns: ['sale_id']
            isOneToOne: false
            referencedRelation: 'sales'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sale_items_service_id_fkey'
            columns: ['service_id']
            isOneToOne: false
            referencedRelation: 'services'
            referencedColumns: ['id']
          },
        ]
      }
      sales: {
        Row: {
          commission_centavos: number
          created_at: string
          employee_id: string
          id: string
          payment_method: Database['public']['Enums']['payment_method']
          plate_number: string | null
          receipt_no: number
          size: string
          sold_at: string
          total_centavos: number
          vehicle_class: Database['public']['Enums']['vehicle_class']
          vehicle_note: string | null
          voided_at: string | null
        }
        Insert: {
          commission_centavos?: number
          created_at?: string
          employee_id: string
          id?: string
          payment_method?: Database['public']['Enums']['payment_method']
          plate_number?: string | null
          receipt_no?: never
          size: string
          sold_at?: string
          total_centavos?: number
          vehicle_class: Database['public']['Enums']['vehicle_class']
          vehicle_note?: string | null
          voided_at?: string | null
        }
        Update: {
          commission_centavos?: number
          created_at?: string
          employee_id?: string
          id?: string
          payment_method?: Database['public']['Enums']['payment_method']
          plate_number?: string | null
          receipt_no?: never
          size?: string
          sold_at?: string
          total_centavos?: number
          vehicle_class?: Database['public']['Enums']['vehicle_class']
          vehicle_note?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'sales_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      service_prices: {
        Row: {
          created_at: string
          id: string
          price_centavos: number
          service_id: string
          size_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          price_centavos: number
          service_id: string
          size_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          price_centavos?: number
          service_id?: string
          size_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'service_prices_service_id_fkey'
            columns: ['service_id']
            isOneToOne: false
            referencedRelation: 'services'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'service_prices_size_id_fkey'
            columns: ['size_id']
            isOneToOne: false
            referencedRelation: 'vehicle_sizes'
            referencedColumns: ['id']
          },
        ]
      }
      services: {
        Row: {
          category: Database['public']['Enums']['service_category']
          commission_rate_bp: number
          created_at: string
          id: string
          is_active: boolean
          is_open_price: boolean
          name: string
          sort_order: number
          updated_at: string
          vehicle_class: Database['public']['Enums']['vehicle_class']
        }
        Insert: {
          category: Database['public']['Enums']['service_category']
          commission_rate_bp: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_open_price?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          vehicle_class?: Database['public']['Enums']['vehicle_class']
        }
        Update: {
          category?: Database['public']['Enums']['service_category']
          commission_rate_bp?: number
          created_at?: string
          id?: string
          is_active?: boolean
          is_open_price?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          vehicle_class?: Database['public']['Enums']['vehicle_class']
        }
        Relationships: []
      }
      vehicle_sizes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
          vehicle_class: Database['public']['Enums']['vehicle_class']
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          vehicle_class: Database['public']['Enums']['vehicle_class']
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          vehicle_class?: Database['public']['Enums']['vehicle_class']
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_role: { Args: never; Returns: string }
      create_sale: {
        Args: {
          p_employee_ids: string[]
          p_items: Json
          p_payment_method?: Database['public']['Enums']['payment_method']
          p_plate_number?: string
          p_size: string
          p_vehicle_class: Database['public']['Enums']['vehicle_class']
          p_vehicle_note?: string
        }
        Returns: string
      }
      finalize_payroll_period: {
        Args: { p_week_start: string }
        Returns: string
      }
      is_owner: { Args: never; Returns: boolean }
      recalc_sale_totals: { Args: { p_sale_id: string }; Returns: undefined }
      set_service_status: {
        Args: {
          p_sale_item_id: string
          p_status: Database['public']['Enums']['service_status']
        }
        Returns: undefined
      }
      reopen_payroll_period: {
        Args: { p_period_id: string }
        Returns: undefined
      }
      service_sale_counts: {
        Args: never
        Returns: {
          sale_count: number
          service_id: string
        }[]
      }
    }
    Enums: {
      payment_method: 'cash' | 'gcash' | 'card' | 'bank_transfer'
      payroll_status: 'open' | 'finalized'
      service_category: 'basic' | 'package' | 'addon'
      service_status: 'pending' | 'done' | 'refunded'
      vehicle_class: 'car' | 'motorcycle'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      payment_method: ['cash', 'gcash', 'card', 'bank_transfer'],
      payroll_status: ['open', 'finalized'],
      service_category: ['basic', 'package', 'addon'],
      vehicle_class: ['car', 'motorcycle'],
    },
  },
} as const
