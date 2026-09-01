table_name,column_name,data_type

waiver_claims,created_at,timestamp with time zone

user_roles,user_id,uuid

user_roles,role,USER-DEFINED

user_roles,created_at,timestamp with time zone

league_scoring_settings,rush_2pt,numeric

league_scoring_settings,rec_points,numeric

league_scoring_settings,rec_yd,numeric

league_scoring_settings,rec_td,numeric

league_scoring_settings,rec_2pt,numeric

league_scoring_settings,fum_lost,numeric

league_scoring_settings,fum_rec_td,numeric

league_scoring_settings,pat_made,numeric

league_scoring_settings,pat_miss,numeric

league_scoring_settings,fgm_0_19,numeric

league_scoring_settings,fgm_20_29,numeric

league_scoring_settings,fgm_30_39,numeric

league_scoring_settings,fgm_40_49,numeric

league_scoring_settings,fgm_50_p,numeric

league_scoring_settings,fgmiss,numeric

league_scoring_settings,blk_kick,numeric

league_scoring_settings,def_st_td,numeric

league_scoring_settings,def_2pt,numeric

league_scoring_settings,ff,numeric

league_scoring_settings,fum_rec,numeric

league_scoring_settings,int_ret,numeric

league_scoring_settings,safe,numeric

league_scoring_settings,sack,numeric

league_scoring_settings,pts_allow_0,numeric

league_scoring_settings,pts_allow_1_6,numeric

league_scoring_settings,pts_allow_7_13,numeric

league_scoring_settings,pts_allow_14_20,numeric

league_scoring_settings,pts_allow_21_27,numeric

league_scoring_settings,pts_allow_28_34,numeric

league_scoring_settings,pts_allow_35_p,numeric

league_historical_archive,id,uuid

league_historical_archive,league_id,uuid

league_historical_archive,year,integer

league_historical_archive,champion_id,uuid

league_historical_archive,final_rank_json,jsonb

league_historical_archive,highest_week_player_score,numeric

league_historical_archive,highest_week_player_user_id,uuid

league_historical_archive,highest_week_team_user_id,uuid

league_historical_archive,highest_week_team_score,numeric

league_historical_archive,highest_reg_season_total_user_id,uuid

league_historical_archive,highest_reg_season_total_score,numeric

league_historical_archive,created_at,timestamp with time zone

waiver_claims,id,uuid

waiver_claims,league_id,uuid

waiver_claims,user_id,uuid

user_roles,id,uuid

invite_codes,created_by,uuid

invite_codes,created_at,timestamp with time zone

hof_championships,id,uuid

hof_championships,year,integer

hof_championships,created_at,timestamp with time zone

hof_player_week_records,id,uuid

hof_player_week_records,year,integer

hof_player_week_records,points,numeric

hof_player_week_records,created_at,timestamp with time zone

hof_team_week_records,id,uuid

hof_team_week_records,year,integer

hof_team_week_records,points,numeric

hof_team_week_records,created_at,timestamp with time zone

hof_team_season_records,id,uuid

hof_team_season_records,year,integer

hof_team_season_records,points,numeric

hof_team_season_records,created_at,timestamp with time zone

profiles,id,uuid

profiles,is_verified,boolean

profiles,created_at,timestamp with time zone

leagues,id,uuid

leagues,current_week,integer

leagues,is_locked,boolean

leagues,created_at,timestamp with time zone

leagues,playoff_start_week,integer

leagues,draft_pick_time_limit,integer

leagues,current_draft_round,integer

leagues,current_draft_pick,integer

leagues,draft_order_json,jsonb

leagues,qb_slots,integer

leagues,rb_slots,integer

leagues,wr_slots,integer

leagues,te_slots,integer

leagues,flex_slots,integer

leagues,bench_slots,integer

leagues,ir_slots_allowed,integer

leagues,max_roster_spots,integer

league_members,id,uuid

league_members,league_id,uuid

league_members,user_id,uuid

league_members,is_creator,boolean

league_members,waiver_priority_number,integer

league_members,created_at,timestamp with time zone

league_schedules,id,uuid

league_schedules,league_id,uuid

league_schedules,year,integer

league_schedules,week,integer

league_schedules,matchup_id,integer

league_schedules,user_id,uuid

league_schedules,opponent_id,uuid