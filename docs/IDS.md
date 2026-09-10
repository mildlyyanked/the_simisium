# Canonical IDs

Every module must use these exact ids. Add new ids only in the module that owns the catalog, and prefer these when referencing across modules.

## Needs (`NeedId`)
`hunger thirst energy bladder hygiene social fun comfort` — 0..100, 100 = satisfied.

## Skills (`SkillId`) — owned by `content/skills.ts`
`cooking baking mixology fitness athletics charisma comedy negotiation logic research programming creativity writing painting photography music singing dancing guitar piano gardening handiness mechanics driving gaming parenting medicine law finance crafting fishing spanish`

## Traits (`TraitId`) — owned by `content/traits.ts`
`ambitious lazy cheerful gloomy hot_headed outgoing loner romantic family_oriented bookworm foodie neat slob active couch_potato creative genius materialistic frugal kleptomaniac kind mean jealous loyal insomniac night_owl early_bird adventurous homebody geek music_lover animal_lover vegetarian workaholic perfectionist clumsy brave coward snob childish hopeless_romantic commitment_issues party_animal spiritual skeptic generous gossip vain self_assured anxious empathetic stoic hypochondriac thrill_seeker`

## Item ids (`ItemId`) — owned by `content/items.ts`
Groceries: `eggs milk bread rice pasta chicken beef ground_beef fish shrimp tofu vegetables salad_greens fruit potatoes onions tomatoes cheese butter yogurt coffee_beans tea sugar flour cereal snacks chips soda juice beer wine liquor water_bottle energy_drink frozen_pizza ramen ice_cream chocolate cookies protein_bar baby_formula diapers`
Prepared food: `meal_basic meal_good meal_gourmet leftovers takeout_meal sandwich coffee_cup smoothie fast_food_meal restaurant_meal`
Toiletries/household: `toothpaste soap shampoo toilet_paper laundry_detergent dish_soap trash_bags cleaning_supplies paper_towels deodorant razor sunscreen bug_spray lightbulb batteries`
Medicine: `painkillers cold_medicine antibiotics vitamins bandages allergy_meds antacid prescription_meds birth_control condoms pregnancy_test first_aid_kit`
Pet: `dog_food cat_food cat_litter pet_treats pet_toy leash`
Misc: `phone_charger gift_flowers gift_chocolate gift_generic book_novel textbook notebook cigarettes vape cannabis_flower lottery_ticket umbrella gas_can bus_pass movie_ticket concert_ticket event_ticket gift_card tool_kit paint_supplies guitar_strings fishing_bait seeds`
Clothing: `outfit_casual outfit_business outfit_formal outfit_athletic outfit_winter_coat outfit_swimwear shoes_sneakers shoes_dress`

## Object def ids — owned by `content/objects.ts` (archetypes reference these)
Home: `bed_single bed_double bed_king crib toddler_bed sofa armchair beanbag dining_table coffee_table desk office_chair chair bookshelf dresser closet nightstand lamp mirror rug houseplant wall_art tv tv_big gaming_console computer laptop stereo record_player bluetooth_speaker fridge stove oven microwave toaster coffee_maker espresso_machine kettle blender air_fryer dishwasher kitchen_sink counter pantry_shelf bathroom_sink toilet shower bathtub washer dryer laundry_basket vacuum trash_can recycling_bin thermostat ac_window space_heater smoke_detector security_camera door_lock treadmill weight_bench dumbbells yoga_mat exercise_bike punching_bag piano keyboard guitar drum_kit easel pottery_wheel sewing_machine workbench tool_chest garden_bed planter lawn_mower grill fire_pit patio_set hot_tub pool_home hammock bike_rack car_charger_home dog_bed cat_tree litter_box aquarium bird_cage hamster_cage toy_box board_games puzzle chess_set telescope bar_cart wine_rack humidor safe filing_cabinet printer`
Commercial/public: `cash_register self_checkout shopping_cart grocery_shelf produce_display deli_counter bakery_case pharmacy_counter atm_machine bank_teller_window loan_desk cafe_counter cafe_table barista_station restaurant_table host_stand kitchen_line bar_counter bar_stool dance_floor dj_booth stage jukebox pool_table dartboard karaoke_machine arcade_cabinet claw_machine bowling_lane slot_machine poker_table roulette_table gym_treadmill gym_rack squat_rack rowing_machine elliptical spin_bike sauna lap_pool basketball_court tennis_court soccer_field baseball_diamond golf_tee climbing_wall ice_rink_surface yoga_studio_floor massage_table salon_chair barber_chair nail_station tattoo_chair tanning_bed exam_table hospital_bed waiting_room_chair dental_chair xray_machine vet_exam_table pet_kennel adoption_pen library_shelf study_table reading_nook computer_terminal lecture_hall_seat classroom_desk whiteboard lab_bench locker school_cafeteria_table daycare_playmat office_desk conference_table cubicle break_room_fridge water_cooler copier warehouse_shelf forklift loading_dock assembly_line cinema_seat concession_stand theater_seat concert_stage stadium_seat museum_exhibit zoo_enclosure aquarium_tank roller_coaster ferris_wheel carousel park_bench picnic_table playground_set swing_set walking_trail hiking_trail campfire fishing_pier beach_towel_spot volleyball_net public_restroom vending_machine food_truck farmers_stall flower_display bus_stop_sign train_platform ticket_kiosk airport_gate security_checkpoint fuel_pump ev_charger car_wash_bay car_lift parts_counter dealer_lot rental_counter parking_space hotel_bed hotel_lobby_desk pew altar candle_stand community_hall_table soup_kitchen_counter cot courthouse_bench judge_bench jury_box holding_cell jail_bunk police_desk fire_engine mailbox post_counter dmv_window city_hall_desk lawyer_desk accountant_desk insurance_desk realtor_desk storage_unit laundromat_washer laundromat_dryer thrift_rack clothing_rack fitting_room electronics_display furniture_showroom hardware_aisle bookstore_shelf liquor_shelf dispensary_counter florist_counter butcher_counter`

## Careers (`CareerId`) — owned by `content/careers.ts`
`retail_associate cashier barista server line_cook fast_food_crew bartender host warehouse_associate delivery_driver rideshare_driver truck_driver mail_carrier janitor security_guard hotel_clerk housekeeper hair_stylist nail_tech personal_trainer yoga_instructor lifeguard daycare_worker teacher_k12 professor tutor librarian nurse_cna nurse_rn doctor pharmacist pharmacy_tech dental_hygienist vet_tech veterinarian therapist social_worker emt firefighter police_officer paralegal lawyer accountant bank_teller loan_officer financial_analyst insurance_agent real_estate_agent sales_rep marketing_specialist hr_specialist office_admin receptionist software_engineer it_support data_analyst product_manager graphic_designer photographer musician writer journalist actor streamer electrician plumber mechanic construction_worker carpenter hvac_tech landscaper farmer_market_vendor scientist lab_tech chef baker florist tattoo_artist flight_attendant bus_driver gig_tasker drug_dealer`

## Crimes (`CrimeId`) — owned by `content/crimes.ts`
`shoplifting petty_theft grand_theft burglary robbery vandalism assault battery dui speeding reckless_driving hit_and_run driving_without_license expired_registration parking_violation jaywalking littering noise_violation public_intoxication disorderly_conduct trespassing drug_possession drug_dealing fraud identity_theft tax_evasion fare_evasion underage_drinking illegal_gambling prostitution arson domestic_disturbance animal_neglect child_neglect resisting_arrest contempt_of_court`

## Holidays (`HolidayId`) — owned by `content/holidays.ts`
`new_years_day mlk_day groundhog_day super_bowl_sunday valentines_day presidents_day mardi_gras st_patricks_day april_fools easter earth_day tax_day cinco_de_mayo mothers_day memorial_day fathers_day juneteenth pride independence_day labor_day back_to_school columbus_day halloween election_day veterans_day thanksgiving black_friday hanukkah christmas_eve christmas kwanzaa new_years_eve lunar_new_year diwali ramadan_start eid daylight_saving_start daylight_saving_end`

## Venue archetypes
See `VenueArchetype` in `core/types.ts` — the union is the canonical list.

## Action id conventions
- Object interaction: `obj:<objectId>:<interactionId>`
- Venue action: `venue:<venueId>:<interactionId>`
- Travel: `travel:<venueId>:<mode>`
- Social with a sim: `social:<simId>:<interactionId>`
- Pet: `pet:<petId>:<interactionId>`
- Phone: `phone:<app>:<interactionId>[:<targetId>]`
- Career: `career:<interactionId>` ; Education: `education:<interactionId>` ; Finance: `finance:<interactionId>` ; Legal: `legal:<interactionId>` ; Shop: `shop:<venueId>:<itemId>` / `shop:<venueId>:cart` ; Property: `property:<interactionId>` ; Transport: `transport:<interactionId>`
- Freeform: `freeform` (params.text)

## Scheduled event kinds (`ScheduledEvent.kind`)
`bill_due paycheck shift_start shift_end school_start school_end homework_due exam interview court_date appointment_doctor appointment_vet lease_end delivery visitor party festival holiday birthday reminder jury_duty election tax_deadline registration_expiry license_expiry insurance_renewal probation_end release pregnancy_due age_up story_beat` — prefix with `_` for hidden internal timers.
