export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      pain_quiz_submissions: {
        Row: {
          aggravating_activities: string[] | null
          body_adaptations: number | null
          created_at: string | null
          daily_activities_impact: number | null
          dominant_system: string | null
          email: string
          first_name: string
          ghl_contact_id: string | null
          id: string
          insights: string[] | null
          joint_bone_alignment: number | null
          last_name: string
          life_impact: string[] | null
          other_conditions: string[] | null
          pain_duration: string | null
          pain_intensity: string | null
          pain_locations: string[] | null
          pain_qualities: string[] | null
          pain_timing: string[] | null
          pattern_duration: number | null
          pattern_signature: string | null
          phone: string | null
          recovery_potential: number | null
          sent_to_ghl: boolean | null
          soft_tissue_tension: number | null
          treatment_results: string | null
          treatments_tried: string[] | null
        }
        Insert: {
          aggravating_activities?: string[] | null
          body_adaptations?: number | null
          created_at?: string | null
          daily_activities_impact?: number | null
          dominant_system?: string | null
          email: string
          first_name: string
          ghl_contact_id?: string | null
          id?: string
          insights?: string[] | null
          joint_bone_alignment?: number | null
          last_name: string
          life_impact?: string[] | null
          other_conditions?: string[] | null
          pain_duration?: string | null
          pain_intensity?: string | null
          pain_locations?: string[] | null
          pain_qualities?: string[] | null
          pain_timing?: string[] | null
          pattern_duration?: number | null
          pattern_signature?: string | null
          phone?: string | null
          recovery_potential?: number | null
          sent_to_ghl?: boolean | null
          soft_tissue_tension?: number | null
          treatment_results?: string | null
          treatments_tried?: string[] | null
        }
        Update: {
          aggravating_activities?: string[] | null
          body_adaptations?: number | null
          created_at?: string | null
          daily_activities_impact?: number | null
          dominant_system?: string | null
          email?: string
          first_name?: string
          ghl_contact_id?: string | null
          id?: string
          insights?: string[] | null
          joint_bone_alignment?: number | null
          last_name?: string
          life_impact?: string[] | null
          other_conditions?: string[] | null
          pain_duration?: string | null
          pain_intensity?: string | null
          pain_locations?: string[] | null
          pain_qualities?: string[] | null
          pain_timing?: string[] | null
          pattern_duration?: number | null
          pattern_signature?: string | null
          phone?: string | null
          recovery_potential?: number | null
          sent_to_ghl?: boolean | null
          soft_tissue_tension?: number | null
          treatment_results?: string | null
          treatments_tried?: string[] | null
        }
        Relationships: []
      }
      quiz_submissions: {
        Row: {
          aggravating_activities: string[] | null
          body_adaptations: number | null
          created_at: string | null
          daily_activities_impact: number | null
          dominant_system: string | null
          email: string
          first_name: string
          ghl_contact_id: string | null
          id: string
          insights: string[] | null
          joint_bone_alignment: number | null
          last_name: string
          life_impact: string[] | null
          other_conditions: string[] | null
          pain_duration: string | null
          pain_intensity: string | null
          pain_locations: string[] | null
          pain_qualities: string[] | null
          pain_timing: string[] | null
          pattern_duration: number | null
          pattern_signature: string | null
          phone: string | null
          recovery_potential: number | null
          sent_to_ghl: boolean | null
          soft_tissue_tension: number | null
          treatment_results: string | null
          treatments_tried: string[] | null
        }
        Insert: {
          aggravating_activities?: string[] | null
          body_adaptations?: number | null
          created_at?: string | null
          daily_activities_impact?: number | null
          dominant_system?: string | null
          email: string
          first_name: string
          ghl_contact_id?: string | null
          id?: string
          insights?: string[] | null
          joint_bone_alignment?: number | null
          last_name: string
          life_impact?: string[] | null
          other_conditions?: string[] | null
          pain_duration?: string | null
          pain_intensity?: string | null
          pain_locations?: string[] | null
          pain_qualities?: string[] | null
          pain_timing?: string[] | null
          pattern_duration?: number | null
          pattern_signature?: string | null
          phone?: string | null
          recovery_potential?: number | null
          sent_to_ghl?: boolean | null
          soft_tissue_tension?: number | null
          treatment_results?: string | null
          treatments_tried?: string[] | null
        }
        Update: {
          aggravating_activities?: string[] | null
          body_adaptations?: number | null
          created_at?: string | null
          daily_activities_impact?: number | null
          dominant_system?: string | null
          email?: string
          first_name?: string
          ghl_contact_id?: string | null
          id?: string
          insights?: string[] | null
          joint_bone_alignment?: number | null
          last_name?: string
          life_impact?: string[] | null
          other_conditions?: string[] | null
          pain_duration?: string | null
          pain_intensity?: string | null
          pain_locations?: string[] | null
          pain_qualities?: string[] | null
          pain_timing?: string[] | null
          pattern_duration?: number | null
          pattern_signature?: string | null
          phone?: string | null
          recovery_potential?: number | null
          sent_to_ghl?: boolean | null
          soft_tissue_tension?: number | null
          treatment_results?: string | null
          treatments_tried?: string[] | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
