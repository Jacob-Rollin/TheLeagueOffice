export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      hof_championships: {
        Row: {
          created_at: string
          fantasy_team_name: string
          id: string
          manager_name: string
          wins_losses: string | null
          year: number
        }
        Insert: {
          created_at?: string
          fantasy_team_name: string
          id?: string
          manager_name: string
          wins_losses?: string | null
          year: number
        }
        Update: {
          created_at?: string
          fantasy_team_name?: string
          id?: string
          manager_name?: string
          wins_losses?: string | null
          year?: number
        }
        Relationships: []
      }
      hof_player_week_records: {
        Row: {
          created_at: string
          fantasy_team_name: string | null
          id: string
          manager_name: string | null
          player_name: string
          points: number | null
          week: string | null
          year: number
        }
        Insert: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          player_name: string
          points?: number | null
          week?: string | null
          year: number
        }
        Update: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          player_name?: string
          points?: number | null
          week?: string | null
          year?: number
        }
        Relationships: []
      }
      hof_team_season_records: {
        Row: {
          created_at: string
          fantasy_team_name: string | null
          id: string
          manager_name: string | null
          points: number | null
          year: number
        }
        Insert: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          points?: number | null
          year: number
        }
        Update: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          points?: number | null
          year?: number
        }
        Relationships: []
      }
      hof_team_week_records: {
        Row: {
          created_at: string
          fantasy_team_name: string | null
          id: string
          manager_name: string | null
          points: number | null
          week: string | null
          year: number
        }
        Insert: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          points?: number | null
          week?: string | null
          year: number
        }
        Update: {
          created_at?: string
          fantasy_team_name?: string | null
          id?: string
          manager_name?: string | null
          points?: number | null
          week?: string | null
          year?: number
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_historical_archive: {
        Row: {
          champion_id: string | null
          created_at: string
          final_rank_json: Json
          highest_reg_season_total_score: number | null
          highest_reg_season_total_user_id: string | null
          highest_week_player_id: string | null
          highest_week_player_score: number | null
          highest_week_player_user_id: string | null
          highest_week_team_score: number | null
          highest_week_team_user_id: string | null
          id: string
          league_id: string
          year: number
        }
        Insert: {
          champion_id?: string | null
          created_at?: string
          final_rank_json?: Json
          highest_reg_season_total_score?: number | null
          highest_reg_season_total_user_id?: string | null
          highest_week_player_id?: string | null
          highest_week_player_score?: number | null
          highest_week_player_user_id?: string | null
          highest_week_team_score?: number | null
          highest_week_team_user_id?: string | null
          id?: string
          league_id: string
          year: number
        }
        Update: {
          champion_id?: string | null
          created_at?: string
          final_rank_json?: Json
          highest_reg_season_total_score?: number | null
          highest_reg_season_total_user_id?: string | null
          highest_week_player_id?: string | null
          highest_week_player_score?: number | null
          highest_week_player_user_id?: string | null
          highest_week_team_score?: number | null
          highest_week_team_user_id?: string | null
          id?: string
          league_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_historical_archive_champion_id_fkey"
            columns: ["champion_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_historical_archive_highest_reg_season_total_user_id_fkey"
            columns: ["highest_reg_season_total_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_historical_archive_highest_week_player_user_id_fkey"
            columns: ["highest_week_player_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_historical_archive_highest_week_team_user_id_fkey"
            columns: ["highest_week_team_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_historical_archive_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_members: {
        Row: {
          created_at: string
          id: string
          is_creator: boolean
          league_id: string
          role: string
          team_name: string
          user_id: string
          waiver_priority_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_creator?: boolean
          league_id: string
          role?: string
          team_name: string
          user_id: string
          waiver_priority_number?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_creator?: boolean
          league_id?: string
          role?: string
          team_name?: string
          user_id?: string
          waiver_priority_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_schedules: {
        Row: {
          created_at: string
          id: string
          league_id: string
          matchup_id: number
          opponent_id: string
          user_id: string
          week: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          matchup_id: number
          opponent_id: string
          user_id: string
          week: number
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          matchup_id?: number
          opponent_id?: string
          user_id?: string
          week?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_schedules_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_schedules_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_scoring_settings: {
        Row: {
          blk_kick: number
          def_2pt: number
          def_st_td: number
          ff: number
          fgm_0_19: number
          fgm_20_29: number
          fgm_30_39: number
          fgm_40_49: number
          fgm_50_p: number
          fgmiss: number
          fum_lost: number
          fum_rec: number
          fum_rec_td: number
          int_ret: number
          league_id: string
          pass_2pt: number
          pass_int: number
          pass_td: number
          pass_yd: number
          pat_made: number
          pat_miss: number
          pts_allow_0: number
          pts_allow_1_6: number
          pts_allow_14_20: number
          pts_allow_21_27: number
          pts_allow_28_34: number
          pts_allow_35_p: number
          pts_allow_7_13: number
          rec_2pt: number
          rec_points: number
          rec_td: number
          rec_yd: number
          rush_2pt: number
          rush_td: number
          rush_yd: number
          sack: number
          safe: number
          scoring_preset: string
        }
        Insert: {
          blk_kick?: number
          def_2pt?: number
          def_st_td?: number
          ff?: number
          fgm_0_19?: number
          fgm_20_29?: number
          fgm_30_39?: number
          fgm_40_49?: number
          fgm_50_p?: number
          fgmiss?: number
          fum_lost?: number
          fum_rec?: number
          fum_rec_td?: number
          int_ret?: number
          league_id: string
          pass_2pt?: number
          pass_int?: number
          pass_td?: number
          pass_yd?: number
          pat_made?: number
          pat_miss?: number
          pts_allow_0?: number
          pts_allow_1_6?: number
          pts_allow_14_20?: number
          pts_allow_21_27?: number
          pts_allow_28_34?: number
          pts_allow_35_p?: number
          pts_allow_7_13?: number
          rec_2pt?: number
          rec_points?: number
          rec_td?: number
          rec_yd?: number
          rush_2pt?: number
          rush_td?: number
          rush_yd?: number
          sack?: number
          safe?: number
          scoring_preset?: string
        }
        Update: {
          blk_kick?: number
          def_2pt?: number
          def_st_td?: number
          ff?: number
          fgm_0_19?: number
          fgm_20_29?: number
          fgm_30_39?: number
          fgm_40_49?: number
          fgm_50_p?: number
          fgmiss?: number
          fum_lost?: number
          fum_rec?: number
          fum_rec_td?: number
          int_ret?: number
          league_id?: string
          pass_2pt?: number
          pass_int?: number
          pass_td?: number
          pass_yd?: number
          pat_made?: number
          pat_miss?: number
          pts_allow_0?: number
          pts_allow_1_6?: number
          pts_allow_14_20?: number
          pts_allow_21_27?: number
          pts_allow_28_34?: number
          pts_allow_35_p?: number
          pts_allow_7_13?: number
          rec_2pt?: number
          rec_points?: number
          rec_td?: number
          rec_yd?: number
          rush_2pt?: number
          rush_td?: number
          rush_yd?: number
          sack?: number
          safe?: number
          scoring_preset?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_scoring_settings_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: true
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          bench_slots: number
          created_at: string
          current_draft_pick: number
          current_draft_round: number
          current_week: number
          draft_order_json: Json
          draft_pick_time_limit: number
          draft_status: string
          flex_slots: number
          id: string
          invite_code: string
          ir_slots_allowed: number
          is_locked: boolean
          max_roster_spots: number
          name: string
          playoff_start_week: number
          qb_slots: number
          rb_slots: number
          te_slots: number
          wr_slots: number
        }
        Insert: {
          bench_slots?: number
          created_at?: string
          current_draft_pick?: number
          current_draft_round?: number
          current_week?: number
          draft_order_json?: Json
          draft_pick_time_limit?: number
          draft_status?: string
          flex_slots?: number
          id?: string
          invite_code: string
          ir_slots_allowed?: number
          is_locked?: boolean
          max_roster_spots?: number
          name: string
          playoff_start_week?: number
          qb_slots?: number
          rb_slots?: number
          te_slots?: number
          wr_slots?: number
        }
        Update: {
          bench_slots?: number
          created_at?: string
          current_draft_pick?: number
          current_draft_round?: number
          current_week?: number
          draft_order_json?: Json
          draft_pick_time_limit?: number
          draft_status?: string
          flex_slots?: number
          id?: string
          invite_code?: string
          ir_slots_allowed?: number
          is_locked?: boolean
          max_roster_spots?: number
          name?: string
          playoff_start_week?: number
          qb_slots?: number
          rb_slots?: number
          te_slots?: number
          wr_slots?: number
        }
        Relationships: []
      }
      lineups: {
        Row: {
          bench: string[] | null
          flex: string[] | null
          id: string
          ir: string[] | null
          league_id: string
          player_points: Json
          qb: string[] | null
          rb: string[] | null
          te: string[] | null
          team_total_points: number
          updated_at: string
          user_id: string
          week: number
          wr: string[] | null
          year: number
        }
        Insert: {
          bench?: string[] | null
          flex?: string[] | null
          id?: string
          ir?: string[] | null
          league_id: string
          player_points?: Json
          qb?: string[] | null
          rb?: string[] | null
          te?: string[] | null
          team_total_points?: number
          updated_at?: string
          user_id: string
          week: number
          wr?: string[] | null
          year: number
        }
        Update: {
          bench?: string[] | null
          flex?: string[] | null
          id?: string
          ir?: string[] | null
          league_id?: string
          player_points?: Json
          qb?: string[] | null
          rb?: string[] | null
          te?: string[] | null
          team_total_points?: number
          updated_at?: string
          user_id?: string
          week?: number
          wr?: string[] | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "lineups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_verified: boolean | null
          role: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_verified?: boolean | null
          role?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_verified?: boolean | null
          role?: string | null
        }
        Relationships: []
      }
      rosters: {
        Row: {
          id: string
          league_id: string
          player_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          league_id: string
          player_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          league_id?: string
          player_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rosters_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rosters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          created_at: string
          details: Json
          id: string
          league_id: string
          type: string
        }
        Insert: {
          created_at?: string
          details: Json
          id?: string
          league_id: string
          type: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          league_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiver_claims: {
        Row: {
          created_at: string
          id: string
          league_id: string
          player_to_add: string
          player_to_drop: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          player_to_add: string
          player_to_drop?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          player_to_add?: string
          player_to_drop?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_claims_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_league_member: {
        Args: { _league_id: string; _user_id: string }
        Returns: boolean
      }
      verify_and_consume_invite_code: {
        Args: { target_code: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
