export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      deficiencies: {
        Row: {
          category: string | null;
          corrected: boolean | null;
          correction_date: string | null;
          created_at: string | null;
          deficiency_desc: string | null;
          deficiency_tag: string | null;
          id: string;
          provider_id: string;
          scope_severity: string | null;
          survey_date: string;
        };
        Insert: {
          category?: string | null;
          corrected?: boolean | null;
          correction_date?: string | null;
          created_at?: string | null;
          deficiency_desc?: string | null;
          deficiency_tag?: string | null;
          id?: string;
          provider_id: string;
          scope_severity?: string | null;
          survey_date: string;
        };
        Update: {
          category?: string | null;
          corrected?: boolean | null;
          correction_date?: string | null;
          created_at?: string | null;
          deficiency_desc?: string | null;
          deficiency_tag?: string | null;
          id?: string;
          provider_id?: string;
          scope_severity?: string | null;
          survey_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deficiencies_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      operators: {
        Row: {
          avg_risk_score: number | null;
          created_at: string | null;
          facility_count: number | null;
          id: string;
          name: string;
          total_ete: number | null;
          total_medicare_payments: number | null;
          updated_at: string | null;
        };
        Insert: {
          avg_risk_score?: number | null;
          created_at?: string | null;
          facility_count?: number | null;
          id?: string;
          name: string;
          total_ete?: number | null;
          total_medicare_payments?: number | null;
          updated_at?: string | null;
        };
        Update: {
          avg_risk_score?: number | null;
          created_at?: string | null;
          facility_count?: number | null;
          id?: string;
          name?: string;
          total_ete?: number | null;
          total_medicare_payments?: number | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      payment_history: {
        Row: {
          created_at: string | null;
          data_source: string | null;
          fiscal_year: number;
          id: string;
          medicare_payments: number | null;
          provider_id: string;
          total_charges: number | null;
          total_days: number | null;
          total_patients: number | null;
        };
        Insert: {
          created_at?: string | null;
          data_source?: string | null;
          fiscal_year: number;
          id?: string;
          medicare_payments?: number | null;
          provider_id: string;
          total_charges?: number | null;
          total_days?: number | null;
          total_patients?: number | null;
        };
        Update: {
          created_at?: string | null;
          data_source?: string | null;
          fiscal_year?: number;
          id?: string;
          medicare_payments?: number | null;
          provider_id?: string;
          total_charges?: number | null;
          total_days?: number | null;
          total_patients?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_history_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      penalties: {
        Row: {
          amount: number | null;
          created_at: string | null;
          description: string | null;
          id: string;
          penalty_date: string;
          penalty_type: string | null;
          provider_id: string;
        };
        Insert: {
          amount?: number | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          penalty_date: string;
          penalty_type?: string | null;
          provider_id: string;
        };
        Update: {
          amount?: number | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          penalty_date?: string;
          penalty_type?: string | null;
          provider_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "penalties_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string | null;
          display_name: string;
          id: string;
          is_verified: boolean | null;
          phone: string | null;
          role: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          display_name: string;
          id: string;
          is_verified?: boolean | null;
          phone?: string | null;
          role?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          display_name?: string;
          id?: string;
          is_verified?: boolean | null;
          phone?: string | null;
          role?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      provider_ownership: {
        Row: {
          created_at: string | null;
          effective_date: string | null;
          id: string;
          operator_id: string | null;
          owner_name: string;
          owner_type: string | null;
          ownership_pct: number | null;
          provider_id: string;
        };
        Insert: {
          created_at?: string | null;
          effective_date?: string | null;
          id?: string;
          operator_id?: string | null;
          owner_name: string;
          owner_type?: string | null;
          ownership_pct?: number | null;
          provider_id: string;
        };
        Update: {
          created_at?: string | null;
          effective_date?: string | null;
          id?: string;
          operator_id?: string | null;
          owner_name?: string;
          owner_type?: string | null;
          ownership_pct?: number | null;
          provider_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_ownership_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_ownership_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      providers: {
        Row: {
          address: string | null;
          annual_medicare_payments: number | null;
          charge_to_payment_ratio: number | null;
          city: string | null;
          cms_data_updated_at: string | null;
          cms_id: string;
          created_at: string | null;
          ete: number | null;
          geom: unknown;
          id: string;
          is_sff: boolean | null;
          is_sff_candidate: boolean | null;
          lat: number | null;
          lng: number | null;
          name: string;
          operator_id: string | null;
          ownership_type: string | null;
          payment_data_source: string | null;
          payment_data_year: number | null;
          phone: string | null;
          provider_type: string | null;
          risk_score: number | null;
          star_rating_health: number | null;
          star_rating_overall: number | null;
          star_rating_quality: number | null;
          star_rating_staffing: number | null;
          state: string | null;
          updated_at: string | null;
          zip: string | null;
        };
        Insert: {
          address?: string | null;
          annual_medicare_payments?: number | null;
          charge_to_payment_ratio?: number | null;
          city?: string | null;
          cms_data_updated_at?: string | null;
          cms_id: string;
          created_at?: string | null;
          ete?: number | null;
          geom?: unknown;
          id?: string;
          is_sff?: boolean | null;
          is_sff_candidate?: boolean | null;
          lat?: number | null;
          lng?: number | null;
          name: string;
          operator_id?: string | null;
          ownership_type?: string | null;
          payment_data_source?: string | null;
          payment_data_year?: number | null;
          phone?: string | null;
          provider_type?: string | null;
          risk_score?: number | null;
          star_rating_health?: number | null;
          star_rating_overall?: number | null;
          star_rating_quality?: number | null;
          star_rating_staffing?: number | null;
          state?: string | null;
          updated_at?: string | null;
          zip?: string | null;
        };
        Update: {
          address?: string | null;
          annual_medicare_payments?: number | null;
          charge_to_payment_ratio?: number | null;
          city?: string | null;
          cms_data_updated_at?: string | null;
          cms_id?: string;
          created_at?: string | null;
          ete?: number | null;
          geom?: unknown;
          id?: string;
          is_sff?: boolean | null;
          is_sff_candidate?: boolean | null;
          lat?: number | null;
          lng?: number | null;
          name?: string;
          operator_id?: string | null;
          ownership_type?: string | null;
          payment_data_source?: string | null;
          payment_data_year?: number | null;
          phone?: string | null;
          provider_type?: string | null;
          risk_score?: number | null;
          star_rating_health?: number | null;
          star_rating_overall?: number | null;
          star_rating_quality?: number | null;
          star_rating_staffing?: number | null;
          state?: string | null;
          updated_at?: string | null;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "providers_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      quality_measures: {
        Row: {
          created_at: string | null;
          data_source: string | null;
          id: string;
          measure_code: string;
          measure_name: string | null;
          national_avg: number | null;
          period: string | null;
          provider_id: string;
          score: number | null;
          state_avg: number | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          data_source?: string | null;
          id?: string;
          measure_code: string;
          measure_name?: string | null;
          national_avg?: number | null;
          period?: string | null;
          provider_id: string;
          score?: number | null;
          state_avg?: number | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          data_source?: string | null;
          id?: string;
          measure_code?: string;
          measure_name?: string | null;
          national_avg?: number | null;
          period?: string | null;
          provider_id?: string;
          score?: number | null;
          state_avg?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quality_measures_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
        ];
      };
      submission_photos: {
        Row: {
          caption: string | null;
          created_at: string | null;
          id: string;
          storage_path: string;
          submission_id: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string | null;
          id?: string;
          storage_path: string;
          submission_id: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string | null;
          id?: string;
          storage_path?: string;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "submission_photos_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          body: string | null;
          created_at: string | null;
          id: string;
          moderated_at: string | null;
          moderated_by: string | null;
          provider_id: string;
          status: string | null;
          user_id: string;
          video_url: string | null;
        };
        Insert: {
          body?: string | null;
          created_at?: string | null;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          provider_id: string;
          status?: string | null;
          user_id: string;
          video_url?: string | null;
        };
        Update: {
          body?: string | null;
          created_at?: string | null;
          id?: string;
          moderated_at?: string | null;
          moderated_by?: string | null;
          provider_id?: string;
          status?: string | null;
          user_id?: string;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "submissions_moderated_by_fkey";
            columns: ["moderated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
