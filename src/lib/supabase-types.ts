// Tipos de la base de datos de patrullan2-dev (v2 online).
// Generado con generate_typescript_types el 2026-11-24 a partir del esquema de
// supabase/migrations/20261124100000_v2_online_base.sql. No editar a mano: regenerar tras cada migración.
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      friendships: {
        Row: {
          addressee_id: string
          created_at: string
          id: number
          requester_id: string
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: never
          requester_id: string
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: never
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invitations: {
        Row: {
          created_at: string
          group_id: number
          invited_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: number
          invited_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: number
          invited_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invitations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: number
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          group_id: number
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          group_id?: number
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          id: number
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_actions: {
        Row: {
          created_at: string
          kind: string
          match_id: string
          payload: Json
          seq: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          kind: string
          match_id: string
          payload?: Json
          seq: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          kind?: string
          match_id?: string
          payload?: Json
          seq?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_actions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_answers: {
        Row: {
          answered_at: string
          correct: boolean | null
          match_id: string
          option_chosen: number
          question_index: number
          user_id: string
        }
        Insert: {
          answered_at?: string
          correct?: boolean | null
          match_id: string
          option_chosen: number
          question_index: number
          user_id: string
        }
        Update: {
          answered_at?: string
          correct?: boolean | null
          match_id?: string
          option_chosen?: number
          question_index?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_answers_match_id_question_index_fkey"
            columns: ["match_id", "question_index"]
            isOneToOne: true
            referencedRelation: "match_questions"
            referencedColumns: ["match_id", "question_index"]
          },
          {
            foreignKeyName: "match_answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_players: {
        Row: {
          connected: boolean
          forfeited: boolean
          joined_at: string
          last_heartbeat: string
          match_id: string
          reported_scores: Json | null
          score: number | null
          seat: number
          user_id: string
        }
        Insert: {
          connected?: boolean
          forfeited?: boolean
          joined_at?: string
          last_heartbeat?: string
          match_id: string
          reported_scores?: Json | null
          score?: number | null
          seat: number
          user_id: string
        }
        Update: {
          connected?: boolean
          forfeited?: boolean
          joined_at?: string
          last_heartbeat?: string
          match_id?: string
          reported_scores?: Json | null
          score?: number | null
          seat?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_questions: {
        Row: {
          bloque: string
          closed_at: string | null
          closes_at: string
          comodines: string[]
          dealt_at: string
          descartadas: number[]
          match_id: string
          nivel: number
          opened_at: string | null
          player_id: string | null
          question_id: string
          question_index: number
          result: string | null
          segundos: number
          tipo: string
        }
        Insert: {
          bloque: string
          closed_at?: string | null
          closes_at: string
          comodines?: string[]
          dealt_at?: string
          descartadas?: number[]
          match_id: string
          nivel: number
          opened_at?: string | null
          player_id?: string | null
          question_id: string
          question_index: number
          result?: string | null
          segundos: number
          tipo: string
        }
        Update: {
          bloque?: string
          closed_at?: string | null
          closes_at?: string
          comodines?: string[]
          dealt_at?: string
          descartadas?: number[]
          match_id?: string
          nivel?: number
          opened_at?: string | null
          player_id?: string | null
          question_id?: string
          question_index?: number
          result?: string | null
          segundos?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_questions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_questions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          code: string
          created_at: string
          current_index: number | null
          finish_reason: string | null
          finished_at: string | null
          host_id: string | null
          id: string
          max_players: number
          mode: string
          seed: number | null
          started_at: string | null
          status: string
          turns: number
          winner_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          current_index?: number | null
          finish_reason?: string | null
          finished_at?: string | null
          host_id?: string | null
          id?: string
          max_players: number
          mode: string
          seed?: number | null
          started_at?: string | null
          status?: string
          turns: number
          winner_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_index?: number | null
          finish_reason?: string | null
          finished_at?: string | null
          host_id?: string | null
          id?: string
          max_players?: number
          mode?: string
          seed?: number | null
          started_at?: string | null
          status?: string
          turns?: number
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_winner_id_fkey"
            columns: ["winner_id"]
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
          display_name: string
          id: string
          last_seen_at: string | null
          username: string
          username_provisional: boolean
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          last_seen_at?: string | null
          username: string
          username_provisional?: boolean
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          last_seen_at?: string | null
          username?: string
          username_provisional?: boolean
        }
        Relationships: []
      }
      questions: {
        Row: {
          bloque: string
          explicacion: string | null
          id: string
          nivel: number
          opciones: Json
          respuesta_correcta: number
          tema: number | null
          texto: string
        }
        Insert: {
          bloque: string
          explicacion?: string | null
          id: string
          nivel: number
          opciones: Json
          respuesta_correcta: number
          tema?: number | null
          texto: string
        }
        Update: {
          bloque?: string
          explicacion?: string | null
          id?: string
          nivel?: number
          opciones?: Json
          respuesta_correcta?: number
          tema?: number | null
          texto?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      block_user: { Args: { p_user: string }; Returns: number }
      cancel_group_invitation: {
        Args: { p_group: number; p_user: string }
        Returns: undefined
      }
      claim_forfeit: {
        Args: { p_match: string; p_user: string }
        Returns: undefined
      }
      create_group: { Args: { p_name: string }; Returns: number }
      create_match: {
        Args: { p_max_players: number; p_mode: string; p_turns: number }
        Returns: {
          code: string
          match_id: string
        }[]
      }
      draw_question: {
        Args: {
          p_bloque: string
          p_match: string
          p_nivel: number
          p_segundos: number
          p_tipo: string
        }
        Returns: number
      }
      get_current_question: {
        Args: { p_match: string }
        Returns: {
          bloque: string
          closed: boolean
          closes_at: string
          descartadas: number[]
          nivel: number
          opciones: Json
          opened: boolean
          player_id: string
          question_index: number
          texto: string
          tipo: string
        }[]
      }
      get_question_result: {
        Args: { p_index: number; p_match: string }
        Returns: {
          explicacion: string
          option_chosen: number
          player_id: string
          question_index: number
          respuesta_correcta: number
          result: string
        }[]
      }
      heartbeat: { Args: { p_match: string }; Returns: undefined }
      invite_to_group: {
        Args: { p_group: number; p_username: string }
        Returns: string
      }
      join_match: { Args: { p_code: string }; Returns: string }
      leave_group: { Args: { p_group: number }; Returns: undefined }
      leave_match: { Args: { p_match: string }; Returns: undefined }
      my_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          last_seen_at: string | null
          username: string
          username_provisional: boolean
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      prepare_account_deletion: { Args: { p_user: string }; Returns: undefined }
      remove_friend: { Args: { p_id: number }; Returns: undefined }
      remove_group_member: {
        Args: { p_group: number; p_user: string }
        Returns: undefined
      }
      report_result: {
        Args: { p_match: string; p_scores: Json }
        Returns: undefined
      }
      respond_friend_request: {
        Args: { p_accept: boolean; p_id: number }
        Returns: undefined
      }
      respond_group_invitation: {
        Args: { p_accept: boolean; p_group: number }
        Returns: undefined
      }
      send_friend_request: { Args: { p_username: string }; Returns: number }
      start_match: { Args: { p_match: string }; Returns: number }
      submit_action: {
        Args: {
          p_expected_seq: number
          p_kind: string
          p_match: string
          p_payload: Json
        }
        Returns: number
      }
      submit_answer: {
        Args: { p_index: number; p_match: string; p_option: number }
        Returns: {
          correct: boolean
          explicacion: string
          respuesta_correcta: number
        }[]
      }
      use_lifeline: {
        Args: { p_index: number; p_kind: string; p_match: string }
        Returns: number[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
