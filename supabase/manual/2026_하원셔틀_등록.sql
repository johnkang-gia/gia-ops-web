-- ============================================================================
-- 2026 하원셔틀 등록 (원본: 2026BUS.xlsx · 2026하원버스 탭)
-- · 학기: 기존 term을 '26-27 1학기'로 수정(FK 유지)
-- · 셔틀: 기존 하원(정규학기) 노선 삭제 후 재등록
-- · 분류: 초등부(명부매칭) / 유치부(반=연령+영어) / 중고등부(그 외) — 유치부는 숨김
-- · 다시 실행해도 중복이 쌓이지 않도록 만들었습니다.
-- ============================================================================
begin;

-- ① 학기 이름 수정: 3학기 → 26-27 1학기 (id 유지 → enrollments 등 FK 그대로)
update terms set term_type = '1학기', year = '26-27', case_id = 'TRM-2627-T1'
  where id = '3a000000-0000-4000-9000-000000000003';

-- ② 유치부·중고등부 학생 등록(명부에 없던 아이들). 결정적 UUID라 재실행하면 갱신됩니다.
--    유치부는 department='유치부'라 대시보드에서 자동으로 숨겨집니다.
insert into wr_students (id, name, department, status, is_demo, note) values
  ('917484b8-49a2-5bb9-a2f8-2358d5831c06', '윤이서', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Albatross'),
  ('6f6e9b14-0d11-5408-824d-03b53a5bca3b', '정하이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Pelican'),
  ('410dc483-45df-5d4d-911a-edc254e044ff', '박다겸', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Seahawk'),
  ('d0966b71-66dd-597c-86e9-9fb630f52945', '정이준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Sparrow'),
  ('1748aa16-6546-57e5-9b46-3ff83b2ed7bb', '조하윤', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Flamingo'),
  ('7993ecaa-367a-5eba-89d6-f5f619a80c58', '이준명', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Parrot'),
  ('e45c6d06-7639-5e1e-8993-378857fcc47e', '박하온', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Owl'),
  ('7cd4151e-1623-5be5-85ea-363fed14b29c', '박연재', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Magpie'),
  ('b24ded3b-ad4e-5764-8a92-25f98909c1d4', '이우빈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Albatross/5 Wren'),
  ('c64f69ac-09f7-5dcd-b6fe-6701e9fdda2c', '김해주', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Wren'),
  ('907e9481-6e94-5b29-b684-bafa46373825', '천재현', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Eagle'),
  ('11825ee3-6183-5087-b729-fa0697ed7417', '윤소희', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Owl'),
  ('1507f7c2-41ad-5e50-99ad-b855c08acbfb', '표연서', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Toucan'),
  ('21d0c175-0521-5f3f-8059-6e382c5b5a35', '김재이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('0be4bf84-3458-5d3d-b1ff-74f9d230bfd0', '방아원', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Cardinal'),
  ('57a8e127-636b-53b0-b6de-e3e11c62fbb6', '조규온', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Crane'),
  ('a6cff066-aca5-54a1-ab36-52a579b81f55', '박채이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Parrot'),
  ('20b3b487-678e-5855-b762-9c591d453598', '정건우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Swan'),
  ('69187733-5a5d-5926-8b49-94de53b7a202', '조이솔', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('bbc6f675-4a2b-58c0-9a4a-e3a35f5e41aa', '문서호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('64772504-226d-5e42-b6c0-87af5fe3259a', '서해인', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Robin'),
  ('9f7b2a5a-9170-5a1e-8628-9a876a6460c1', '장윤우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Eagle'),
  ('3a6a5e3b-0bbd-5160-86df-3fb3ad04b84e', '이로이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('bd306958-aab1-5640-9c50-a986380ecc92', '정윤아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Swan'),
  ('c1796bff-4147-54d7-a423-37e1f542c7d0', '이아린', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Wren'),
  ('34f1a877-1a6d-5aac-b130-04bf31e896f2', '구가빈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('7593a07e-47f3-5725-a9c2-a6cc6a745744', '정은우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Emu 7'),
  ('4ca06908-3864-565c-8e5b-673a91fd6e10', '홍은석', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Magpie 4'),
  ('43ff601d-bf5f-5681-90db-f78f156bdff5', '김문준', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Crane 7'),
  ('d463955c-6a8d-5649-9477-fc84047644a0', '김유하', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Owl 6'),
  ('7f7abff0-5de6-574a-9679-1827dd1006e4', '김태율', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('7ea83049-1dd3-5973-99ac-63e403683f1d', '김주원B', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Swan 6'),
  ('855df5cb-02d1-521a-ae2e-d310ebcbdb18', '안제니', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Robin'),
  ('3b7a7a71-123a-5974-9c82-82fe2183559f', '김예원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Albatross 7 / Peacock 7'),
  ('be8fc1ae-891b-5b6b-be58-6e838ec8eace', '신유안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('f7a52319-643c-5d52-a345-7d5c1f1e2f01', '김연우A', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Seahawk 6'),
  ('84d8029a-9dd0-51eb-9d77-2e4f1311961e', '최시원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Goldfinch 4'),
  ('f5af125b-c745-52c1-ad29-7dbc35df2dd0', '임서진', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('66e6a3f8-e405-59b7-ab80-5babb71b32fb', '황아림 Arim', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('63e047dd-447f-5d17-84ed-1873d1619cd9', '최한빈', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Starling 5'),
  ('7af25bc5-1aa7-5b94-9323-0a7bf90f9fc7', '임서원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Eagle 7'),
  ('4b86c214-d6b6-591c-af30-39f1f0931985', '김주완', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('67cfcba4-e23e-59c4-9849-784e75193a10', '김용재', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('1a653d00-e0b6-5f26-a91a-2b426088dacd', '김시연', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Starling 5'),
  ('2700f4d4-ca41-5196-af2c-0af3280a3b25', '진리안', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Seahawk 6'),
  ('c9a3736f-74d8-54e6-a606-e91ff0d7a81f', '강선우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Skylark 3'),
  ('08a86a17-8055-5dfd-aa8d-bd1e7d311e5a', '김아인', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Pelican 4'),
  ('2eea316f-7227-5276-9020-fdfcbec0ccf0', '박이현', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 '),
  ('a1a214bf-f9d3-5c5d-8514-ebe1ab1808d0', '박지안', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Toucan 5'),
  ('dd9bbc78-225c-57cd-8dcd-877750e2554b', '김하진A', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7crane'),
  ('7b73718d-631b-5f52-85e7-c4f8177ed695', '조시헌', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('864e8bdb-113f-5b44-9509-f25aaee884ca', '김태민', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Dove 4'),
  ('6f79ec4d-55f1-54ec-bbb1-a92bba8e56b9', '이도현', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Eagle 7'),
  ('e69245fe-1d0c-5a79-a703-6de5fff31c03', '김지수', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Falcon 5'),
  ('b14ff7d6-325a-5b05-b89f-744323bad723', '주이솔', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Swan 6 / Goldfinch 4'),
  ('9b8c3d01-7cb9-52f0-a91b-cae32baad7f3', '유태우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Crane 7'),
  ('1a881bca-21c8-5a98-91f8-925a6fa6e25f', '조안나', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Owl 6'),
  ('93060877-0d18-570d-a130-7e351b4c0bdc', '최희윤', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Albatross 7'),
  ('6d0d3584-aed5-5997-b909-d2d475ec1784', '김서진A', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Toucan 5'),
  ('c2682b65-8990-5d6f-b05d-a8f6abc003df', '허은서', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Swan 6'),
  ('f1bdeb74-e13d-53e3-ab68-e777c9e0a402', '신제이', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Toucan 5'),
  ('f832ac02-5cd9-5959-ab2f-13d05e3284ac', '오윤', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 6'),
  ('9eccac18-1c2e-55b7-8c59-d91bdd396ab8', '김규민', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Magpie 4'),
  ('234e8385-c6f7-5b3c-ac2f-ef1d14deb339', '전우현', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Flamingo 6/
Magpie 4'),
  ('89d17f67-36da-535f-b458-01dedcf31739', '권태훈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Goldfinch'),
  ('6b77ab9c-c612-58bb-8dd3-f3ea1585ece2', '김윤우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Goldfinch 4'),
  ('0f0530f8-375f-5edc-8d67-8c53f519e89f', '이준서, 이준우, 임지효', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('d2e134c1-4a73-53e4-b51b-0da2ec5c1232', '김태은A', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Emu 7'),
  ('33fed48c-8e2e-537d-ba60-d39ca03cfea0', '김지원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Owl 6'),
  ('f56813ad-0305-53d3-9b13-c880060b9f00', '손재이', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Nightingale 5'),
  ('479b40d2-00f7-5269-a09e-b95ce1534c10', '김도율', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('96165be7-1ee1-5020-af8a-b4c93896a5ab', '최유진', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Cardinal 5'),
  ('909b8c86-94ba-5b03-a91f-56b584d534bb', '강리안B', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Cardinal 5'),
  ('c40e419d-4ae0-501e-9d2c-0fce551742d1', '김선아', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Parrot 5'),
  ('d0894d8b-3f1b-56cc-a8aa-9584cebb6942', '박시아', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Falcon 5'),
  ('6970ab15-f722-5b49-a934-f9b8fc01682d', '박서연', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Seahawk 6'),
  ('db178cc7-0553-59f1-9033-f51957d99312', '이솔', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Magpie 4'),
  ('2093bffa-f3ca-57e7-bf77-b238b3266070', '정주원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Starling 5'),
  ('e68d5e30-2f8c-5f30-9baf-43da0511cf44', '임지유', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Toucan 5'),
  ('9d6ca115-da8d-503f-b6b3-a9bb68dd89f1', '국서호', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Wren 5'),
  ('bfd5bd58-08a1-59e2-b255-a2af4a90b509', '송도휘', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Parrot 5/Robin 3'),
  ('e63eb5ac-f216-57b5-83ea-4394f6073899', '김선후', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Pelican 4'),
  ('be3075b5-9076-5a81-accd-007d1a2f543e', '이로서', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('ab13bca2-d5c6-5ba3-b633-2de34ad6944f', '홍한울', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Emu/ 4 Dove'),
  ('79096a64-91e4-5d19-8a1d-fbf6e7e10435', '서엘린', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Skylark 3'),
  ('81aa0c00-fa7c-5e10-b9ce-e6810770ca05', '이도호', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Albatross 7'),
  ('435033ca-281d-5072-b7a2-72763ae76598', '최윤정', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Owl 6'),
  ('6a9bd99b-0b08-50df-a851-3d0e2cf494c8', '이지오', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Emu 7/ Dove 4'),
  ('8920f7b9-7bcc-5e9f-9163-e0e1f71a8f1d', '강리안', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Emu 7'),
  ('770964d2-64a8-58e6-9945-4df58b0731e8', '편해율', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Cardinal'),
  ('0dc02a44-7aac-597a-9858-019c4e2d1d1d', '이지원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Eagle 7'),
  ('03e8c6f0-c3d6-5ce1-b55c-0b570621150e', '김제이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Flamingo'),
  ('3de1fbd6-2c83-52aa-8609-ba6103f1611d', '정소이', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Eagle 7'),
  ('bb902111-6cf9-5d0e-97a0-cfa4d0599180', '양지유', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Goldfinch'),
  ('c5a424d1-2059-5213-9fa2-c3b60f60f0f5', '정윤호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Owl'),
  ('a0bb4c09-ad7c-5059-8f39-88730c39a57a', '박세주', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('7b5e734f-fabe-5dc3-a85b-7394fe799018', '박리온', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Flamingo 6'),
  ('af0752ce-aabf-5726-a71b-1412434c1e6c', '신지수', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Dove 4'),
  ('d28e240f-141d-562a-a947-1c4265a1232b', '윤아인', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Goldfinch 4'),
  ('1ce8abb7-fe94-5f43-b68b-446d9fc12f1a', '김채희', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Sparrow'),
  ('8e260c82-9cd4-5280-80f0-25428b2e2361', '오로라', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Nightingale 5'),
  ('30e7eff6-31e5-5e96-8a10-044818821a71', '김로이A', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Flamingo 6'),
  ('42e1e2dc-57c2-5574-a6ad-f27fcae3a3c8', '양우진', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Swan 6'),
  ('76ae3e23-ea12-5998-8973-8ed330463b0d', '김유건', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Nightingale 5'),
  ('056b484c-32aa-54b1-be29-e6cd7b0dbe7f', '김호윤', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Skylark 3'),
  ('1f3559b3-39fa-52ac-a336-1cd462eb3bb6', '전하루', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Starling 5'),
  ('320e331a-83c2-5c5e-908a-f16289320671', '이우현', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Skylark 3'),
  ('ae1298b6-c75b-5711-a981-ab62f17b3a31', '김이선', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Robin 3'),
  ('4ce1d9e4-b30d-578a-a8ab-3a89b8e03c28', '신보석', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Peacock 7'),
  ('71afebb5-77fa-5791-9da5-a84e5786ddd4', '노희권 Harry', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Peacock 7'),
  ('fd9482b0-9678-5e1c-b61f-9b95246e3f1d', '서아루', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Eagle'),
  ('f9627500-dcdc-5374-9154-cf0f5c4f11c7', '김이준B', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Parrot 5'),
  ('ee8de488-856a-5200-9b3a-09d670f79459', '여이서', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Sparrow 4'),
  ('2585f552-f883-59e8-9b63-bfb855fc2540', '허재이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Owl'),
  ('89c1123c-f6dd-5103-83b3-55371870cf2d', '서인우 Inu', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Albatross'),
  ('89cc34cb-f620-5230-9e62-538fbb0d0b69', '김권', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Parrot 5'),
  ('807c5472-a7df-5047-bdf3-4025398f0170', '나유안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Albatross'),
  ('ae05e210-5179-5cc9-bd41-a9abfd22bb86', '김아론', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Emu 7'),
  ('6b3a8ca4-0d90-56da-846a-148f7a71e223', '박태린', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Robin 3'),
  ('c2a23dbb-e2ea-5eae-803e-bcaafbe49294', '권사윤', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Dove 4'),
  ('0135e9bb-33e6-5b28-9454-e7607e85af6b', '이하은', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('b6ba8f66-4252-57a2-94cc-f07b4611daca', '박제이', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kiwi 3'),
  ('518436d3-31b6-537a-8cfd-99622c08395a', '정윤서', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Kite 4'),
  ('0edbb4d4-3aba-5c86-84e6-1e584222d4b5', '위준완', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('c689b367-144d-5b15-a643-921095b736a0', '최온유', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('870abaf3-b781-5991-8d30-95948c8a5c7f', '이건우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Swan 6'),
  ('8f03281d-ef59-55bc-8546-abaf1920f2fc', '류재이', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Wren 5'),
  ('b86f90ea-bff7-5503-b64b-f167d64558d7', '고유안', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Peacock 7/ Wren 5'),
  ('2d76bc3c-b907-56b3-a25d-8becf70d8ee7', '황희', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Falcon 5'),
  ('e471a59b-a724-5ce2-8348-e99feeb7b26d', '신주오', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Flamingo 6'),
  ('54372a9e-0c64-55f2-9df3-d68ef097b079', '박준후', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('9a4b475b-6ba2-5c49-985d-5a014708457f', '장하은', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Eagle'),
  ('1d3a18db-91f7-527c-a1bc-007ee551acc8', '권하린 Harin/ 목요일안탐', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Crane'),
  ('7be23091-86b8-5025-b809-6e70525782d9', '조아정', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Cadinal'),
  ('3a364aa7-3a22-5423-bc4b-f29830fd2536', '배윤', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Eagle'),
  ('5239cc53-e8c0-53b9-b6a8-1af36e9c5ad2', '이수호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Swan'),
  ('3f5c6155-8999-51fd-a554-5ef7d7878c54', '천리안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Toucan'),
  ('e3998302-d340-52ec-80f4-e4334581f5bf', '이해나', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Owl'),
  ('b94cb96c-0b80-5435-b942-99184be0cb4b', '김서진B', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Falcon'),
  ('db9ded9f-990e-59a4-8960-2a91c238f967', '황은우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Toucan'),
  ('69cd2f12-d7ef-5a8c-9b22-3ce9d667d497', '최이서 Yiseo', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Swan'),
  ('2218a0db-e372-5b7a-a370-ff98fc3316b0', '이주환', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Wren'),
  ('20d19acf-79c4-58a2-a219-d2469a627f69', '선해린', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5wren'),
  ('5905a9d4-6d6e-55ba-90ac-66664dfba9cb', '김승후', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('88e874a6-8b7d-53f8-8d72-92f1c8006366', '현이나', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Wren'),
  ('5fbea44d-4ea7-57e4-a8c6-48c10dd25a09', '노다은', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('5c7d3358-8ba9-5091-9426-66a0db2cbb19', '문수민', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('5db5b723-a25f-5589-831a-1e2bc2e12fea', '정이나', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 Seahawk 6'),
  ('fe2ed6fa-423f-52b4-976b-2e990a2ebefc', '정조이 Joie', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Albatross'),
  ('0d736c86-d8db-55f3-b0aa-b508e563a6ae', '이유하 Yuha', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Flamingo'),
  ('a84b8fca-3d77-5e2d-8c55-6adb0b881383', '최이든 Eden', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Flamingo'),
  ('6d756d14-e03b-588c-9f24-a1c9fc6910ef', '조수아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Nightingale'),
  ('ed38b0ed-cad8-5258-bff7-4b844be6b2fb', '황이솔', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Flamingo'),
  ('da57e30c-fe4d-5898-ab51-95d72b18a7b3', '정유하', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4Dove'),
  ('66b6f728-fe67-52df-a1b9-9e6b5f191317', '신이안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3Robin'),
  ('92634934-60df-528a-a650-4f1033070d30', '이리호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Wren'),
  ('d78f2c9f-3816-5ee5-b725-b6fb96deb81a', '조이람', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Goldfinch'),
  ('5115a187-f055-5f01-a8dd-7529be875540', '정다우리', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 '),
  ('878add69-4d50-5f81-af7c-104467ec2867', '이태리', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Owl'),
  ('d8b88aa3-3e95-5b6b-aa9f-d41f021c9b87', '박지아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3Skylark'),
  ('ff2fdfc6-94a7-59c5-8e4b-d6e380553e3b', '이도후', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('c832337c-0a33-5da2-88d1-887392fb0537', '이호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Peacock / 4 Magpie'),
  ('7f2e6971-f809-5fc6-a3d6-0024549784d7', '이서이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4Magpie'),
  ('389cf8eb-7e65-5177-b2fc-3e482f4e52fb', '정유준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Emu'),
  ('4dca415c-dde8-54c5-9c66-7fe107f166d1', '황주원', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Parrot'),
  ('977e64bf-0c24-539a-b6c3-997090192da1', '우하린', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3Skylark'),
  ('ade822bc-50d6-59c6-a965-9b33dfb98481', '이건서', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Sparrow'),
  ('d8539cd4-d607-53be-9e3e-4b175980e90e', '박지음', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('8010ddb0-0438-540b-8f7a-1d1b495f1363', '장벨라', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Kiwi'),
  ('40ab1ca5-0fa3-59ff-9f46-2db790c40cc5', '박제이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3Kiwi'),
  ('0fd8286b-6c62-54a5-9229-3b2ce70a788e', '박시온', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Owl'),
  ('b27d6688-82f9-5196-b36d-e3c3f824c9b1', '김지유', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Seahawk'),
  ('d2ec2efd-b784-574f-8401-0bcc7ddf244c', '김우주', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Crane'),
  ('0b3ca826-0f01-54f2-81b3-783023465b64', '정도율', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Falcon'),
  ('162613db-86bc-5752-8ad9-fb4857040522', '원서정', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Cardinal'),
  ('f24f87ed-77e6-596b-aa20-00e212c12474', '박수현', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Cardinal'),
  ('ad1fccf0-ef98-5e28-9ce9-7df9b5aef05d', '이시우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Eagle'),
  ('1daa8dd9-c9be-537a-b862-2bad993a2ff5', '정재이', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Cardinal'),
  ('3e307dcf-064f-5c0f-bf2f-9690c6efbeac', '조효리', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Emu / 6Kite'),
  ('bab28d92-4cad-5d59-b3ba-338d738e9b02', '정서호 Ari', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Albatross / 5Wren'),
  ('7e485781-98a6-5be8-ab74-da195300dd78', '이주아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4Pelican'),
  ('9f1cea3c-9fc9-5f6a-ba38-de9c9ad9703e', '김도현', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Flamingo'),
  ('30445beb-5f53-5125-bc1b-44998ffd1744', '안라엘', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Toucan'),
  ('6a02a3de-79f6-53db-856f-5acb57e93697', '최지아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3Kiwi'),
  ('5a7e1071-fc25-5de1-aa07-2beaab19d887', '김채윤', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Parrot'),
  ('4971c54c-4e1e-5065-8770-79012e392ddf', '이세령', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Swan'),
  ('e4b8a814-260e-53d8-9f61-1f3534639e5d', '심지훈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Albatross'),
  ('0d2a2cc2-9d18-5937-bff0-b054baa1632c', '장슬예', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Crane'),
  ('ecfee398-0a69-508e-9443-9d7af91c4f1c', '김리하', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Nightingale'),
  ('6983a112-2ff7-5059-ad6a-8847def3c0b7', '박새얀', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5Starling'),
  ('052e7779-85da-507f-b8c5-bb29bf9dcdcd', '손예진', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6Seahawk'),
  ('a9744c75-7e9b-57f1-9605-4449b6f52dd1', '정하준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7Emu / 4Sparrow'),
  ('b6091ea9-6d4c-5ea2-b0a3-cf9ff0c2e654', '박서호', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('2cabcb86-25e6-5ae7-b987-61469fee7b31', '김정원 Jungwon', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('4b4e8d77-5043-52f7-9ce7-32a76ed8ddae', '이유성', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('991bb27e-3ebd-54d5-a230-bd854f297f52', '김연수', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Seahawk'),
  ('4cafcde9-9f6b-5e90-a173-e0f55d2a3c02', '유주아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Starling'),
  ('3878d7ed-779d-51bc-aa0e-39dbf12a9c8d', '어연우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Seahawk / 4 Pelican'),
  ('de01e92f-eeb4-5bf0-bb58-78cb73c53088', '박이준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Crane'),
  ('e9286153-3399-59d4-a7ed-9706540408a7', '조아윤', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Kite'),
  ('fca149ac-965d-5739-a357-9a8a04f03d91', '최유주', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Parrot'),
  ('859bce68-d92a-5691-8605-356b62789d1a', '신예원', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Pelican'),
  ('9aa3cdf0-a093-58fa-b61e-feed69190ee3', '홍도경', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Skylark'),
  ('c231d124-6c45-53b4-a19a-5b4601df4702', '정아인', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Dove'),
  ('ea67ab4f-c774-563a-96d5-42998a3a7497', '허정원', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Emu'),
  ('606ed8ba-3dfa-5b75-a349-ac93a6abfa59', '유아린', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Flamingo'),
  ('31ad5fe5-2b32-5ca5-800e-515a620adb07', '리아채터스', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Magpie'),
  ('05c69c5d-3732-5a52-ab1b-7a961158d019', '오석', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('e3555f9e-4b60-5d45-ab2d-7ac545bdfbff', '김태은', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Wren'),
  ('7a9f7871-a110-56df-9793-3e4628970d66', '이해린', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Robin'),
  ('09167fa3-762a-50fe-a78a-7072146f8520', '바이시우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Kiwi'),
  ('581de5f6-6e31-5179-88c4-0c7c71c51bab', '강수빈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Crane / 5 Starling'),
  ('4af53e42-9c91-510a-8c7d-4553ca7bed64', '박윤솔', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Eagle'),
  ('7cabab1a-529c-589a-8ad3-1efccf7862da', '이지원', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('99849e20-87fa-5770-a2ca-45b8d7d9d6e0', '이세나', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Albatross'),
  ('6c82c32d-5da7-5b81-9c63-3ef2582c5e3c', '오유준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Kiwi'),
  ('ca415a14-83b6-5c66-a3fc-a381d3db0736', '윤벨라', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Skylark'),
  ('60a8ffc0-0806-5575-904d-61d4fd92f8fc', '박지우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Skylark'),
  ('c000f22b-7773-50c8-a84c-9c6a7a10000d', '박세훈', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Parrot'),
  ('a7e0ac41-fa9c-500c-b2ce-02bc04263868', '염시후', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Flamingo'),
  ('da68d0b2-82f9-5940-bccb-96c4937361b8', '이서온', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Seahawk'),
  ('639c264b-6c00-5245-b7cd-53fbcf8aea3f', '강로완', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Flacon'),
  ('923d3262-6a66-52a7-a96d-453fb1844325', '김연우', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 6 Kite'),
  ('bb200eb5-0126-5aaa-b25c-6df48366baee', '강하영', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('43f3eef3-3ed1-5880-957c-03ffa6ad89a1', '강이준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 3 Skylark'),
  ('f33fe061-3c8a-5b5e-afdb-dbf75bbe59d0', '김리아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Peacock'),
  ('76f0a90e-acf7-5065-983a-4846cb3f61a2', '홍리아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Dove'),
  ('ee84179a-c452-5046-b45d-be446ef889b0', '김이준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 7 Crane / 5 Toucan'),
  ('b9affe45-b320-5375-913c-54116114f714', '유태정', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Pelican'),
  ('d2035d2c-fe0a-51c2-bb85-150a97ad6127', '장유안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Sparrow'),
  ('ffeccab8-58fe-5012-a10b-51110e112f66', '김이안', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Falcon'),
  ('a2fe9bc2-7062-56eb-b392-6d9e854136bc', '홍지아', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Magpie'),
  ('ec9cfff5-29d5-59b5-824d-1976d5a20275', '배아린(4월 등원)', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Nightingale'),
  ('a2f9a7bf-d7ec-5f73-8908-8091b1d6cba6', '이하윤', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Pelican'),
  ('84b9b76b-c5fd-5185-a426-dc78915b2a9d', '정승준', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 5 Cardinal'),
  ('a9c86dd3-ed55-53bb-ac05-76eb04a4a58d', '이세린', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('fa7213df-c7d5-5469-abeb-0ec636dd86d0', '박진우', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('5b2ba05f-44f0-51e8-97f5-dbfc49f323ab', '제이콥', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('a28a6c4a-398e-5ee3-b2eb-bcaa65c19cb6', '장하영', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('42ef9403-70ba-5865-8c46-474960df2f49', '심규원', '유치부', 'active', false, '2026하원버스 자동등록 · 반표기 4 Dove'),
  ('145c1a75-442d-5ed8-9d2e-845ff1cc1d8f', '민경건', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('b6fe310d-f8d5-56db-a233-1f26d123d8f5', 'Maria', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교'),
  ('1dcf6a38-ccbf-5de9-ae7d-3046889e104d', '정민호', '중고등부', 'active', false, '2026하원버스 자동등록 · 반표기 학교')
on conflict (id) do update set department = excluded.department, name = excluded.name;

-- ③ 기존 하원(정규학기) 셔틀 비우기 - 정류장/배정은 cascade로 함께 지워집니다.
delete from shuttle_routes where direction = '하원' and term = '정규학기';

-- ④ 노선 → 정류장 → 탑승배정 등록
-- 하원 1호 잠원
with r0 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '1', '잠원', '문형신', '010-2526-9189', '유지연 Jenny', '010-5014-2484', '16:00', 0, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r0.id, v.seq, v.stop_time, v.address from r0, (values
    (0, '16:25', '서초구 잠원로 117 아크로리버뷰 (셔틀버스 정류장)'),
    (1, '16:30', '서초구 잠원로14길 23 롯데캐슬아파트 204-704 (롯데캐슬2차 건너편)'),
    (2, '16:31', '서초구 잠원동 161 신반포 래미안 리오센트 106동'),
    (3, '16:31', '서초구 잠원동 161 신반포 래미안 리오센트 103동'),
    (4, '16:31', '서초구 신반포로33길 15 잠원동아파트')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '917484b8-49a2-5bb9-a2f8-2358d5831c06', '윤이서', '7 Albatross', '{1,2,3,4,5}', '01050257631'),
    (0, '6f6e9b14-0d11-5408-824d-03b53a5bca3b', '정하이', '4 Pelican', '{1,2,3,4,5}', '01096226962'),
    (1, '410dc483-45df-5d4d-911a-edc254e044ff', '박다겸', '6 Seahawk', '{1,2,3,4,5}', '01073758350'),
    (2, 'd0966b71-66dd-597c-86e9-9fb630f52945', '정이준', '4 Sparrow', '{1,2,3,4,5}', '01040046571'),
    (3, '1748aa16-6546-57e5-9b46-3ff83b2ed7bb', '조하윤', '6 Flamingo', '{1,2,3,4,5}', '01086881511'),
    (4, '7993ecaa-367a-5eba-89d6-f5f619a80c58', '이준명', '5 Parrot', '{1,2,3,4,5}', '01033989012')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 1-1호 메이플자이1
with r1 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '1-1', '메이플자이1', '최종진', '010-5201-9498', '신지연 Bonnie', '010-3444-7756', '16:00', 1, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r1.id, v.seq, v.stop_time, v.address from r1, (values
    (0, '16:26', '메이플자이 203동'),
    (1, '16:26', '메이플자이 205동'),
    (2, '16:26', '메이플자이 201동'),
    (3, '16:26', '메이플자이 207동'),
    (4, '16:26', '메이플자이 209동'),
    (5, '16:26', '메이플자이 213동'),
    (6, '16:30', '메이플자이 215동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'e45c6d06-7639-5e1e-8993-378857fcc47e', '박하온', '6 Owl', '{1,2,3,4,5}', '01064820946'),
    (1, '7cd4151e-1623-5be5-85ea-363fed14b29c', '박연재', '4 Magpie', '{1,2,3,4,5}', '01043634314'),
    (1, 'b24ded3b-ad4e-5764-8a92-25f98909c1d4', '이우빈', '7 Albatross/5 Wren', '{1,2,3,4,5}', '01030303443'),
    (1, 'c64f69ac-09f7-5dcd-b6fe-6701e9fdda2c', '김해주', '5 Wren', '{1,2,3,4,5}', '01092726663'),
    (1, '907e9481-6e94-5b29-b684-bafa46373825', '천재현', '7 Eagle', '{1,2,3,4,5}', '01037621185'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01034420078' and name = '김단우' and is_demo=false limit 1), '김단우', '학교/
6 Swan / 4 Pelican', '{1,2,3,4,5}', '01034420078'),
    (3, '11825ee3-6183-5087-b729-fa0697ed7417', '윤소희', '6 Owl', '{1,2,3,4,5}', '01071811397'),
    (3, '1507f7c2-41ad-5e50-99ad-b855c08acbfb', '표연서', '5 Toucan', '{1,2,3,4,5}', '01074949829'),
    (4, '21d0c175-0521-5f3f-8059-6e382c5b5a35', '김재이', '5 Starling', '{1,2,3,4,5}', '01034994343'),
    (5, '0be4bf84-3458-5d3d-b1ff-74f9d230bfd0', '방아원', '5 Cardinal', '{1,2,3,4,5}', '01040920678'),
    (5, '57a8e127-636b-53b0-b6de-e3e11c62fbb6', '조규온', '7 Crane', '{1,2,3,4,5}', '01084473875'),
    (6, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01050452915' and name = '이연우' and is_demo=false limit 1), '이연우', '학교', '{1,2,3,4,5}', '01050452915')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 1-2호 메이플자이2
with r2 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '1-2', '메이플자이2', '유완철', '010-7171-3575', '양정민 Lenny', '010-3917-7725', '16:00', 2, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r2.id, v.seq, v.stop_time, v.address from r2, (values
    (0, '16:30', '서초구 잠원로14길 54 신화아파트 (신사쇼핑 건너편 횡단보도)'),
    (1, '16:33', '메이플자이 105동'),
    (2, '16:33', '메이플자이 106동'),
    (3, '16:33', '메이플자이 103동'),
    (4, '16:33', '메이플자이 102동'),
    (5, '20:43', '메이플자이 110동'),
    (6, '16:36', '메이플자이 107동'),
    (7, '16:36', '메이플자이 104동'),
    (8, '16:36', '메이플자이 114동'),
    (9, '16:36', '메이플자이 109동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01041401683' and name = '박도하' and is_demo=false limit 1), '박도하', '학교', '{1,2,3,4,5}', '01041401683'),
    (1, 'a6cff066-aca5-54a1-ab36-52a579b81f55', '박채이', '5 Parrot', '{1,2,3,4,5}', '01054661211'),
    (2, '20b3b487-678e-5855-b762-9c591d453598', '정건우', '6 Swan', '{1,2,3,4,5}', '01058862653'),
    (2, '69187733-5a5d-5926-8b49-94de53b7a202', '조이솔', '5 Starling', '{1,2,3,4,5}', '01038429601'),
    (3, 'bbc6f675-4a2b-58c0-9a4a-e3a35f5e41aa', '문서호', '5 Starling', '{1,2,3,4,5}', '01092704238'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01050477094' and name = '김서진' and is_demo=false limit 1), '김서진', '학교', '{1,2,3,4,5}', '01050477094'),
    (5, '64772504-226d-5e42-b6c0-87af5fe3259a', '서해인', '3 Robin', '{1,2,3,4,5}', '01071765017'),
    (6, '9f7b2a5a-9170-5a1e-8628-9a876a6460c1', '장윤우', '7 Eagle', '{1,2,3,4,5}', '01073288856'),
    (7, '3a6a5e3b-0bbd-5160-86df-3fb3ad04b84e', '이로이', '5 Nightingale', '{1,2,3,4,5}', '01097896973'),
    (8, 'bd306958-aab1-5640-9c50-a986380ecc92', '정윤아', '6 Swan', '{1,2,3,4,5}', '01045089251'),
    (8, 'c1796bff-4147-54d7-a423-37e1f542c7d0', '이아린', '5 Wren', '{1,2,3,4,5}', '01026998090'),
    (9, '34f1a877-1a6d-5aac-b130-04bf31e896f2', '구가빈', '5 Starling', '{1,2,3,4,5}', '01033895115')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 2호 반포자이
with r3 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '2', '반포자이', '최병로', '010-8877-2234', '송은경', '010-9011-9811', '16:00', 3, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r3.id, v.seq, v.stop_time, v.address from r3, (values
    (0, '16:40', '반포자이')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '7593a07e-47f3-5725-a9c2-a6cc6a745744', '정은우', 'Emu 7', '{1,2,3,4,5}', '01071397519'),
    (0, '4ca06908-3864-565c-8e5b-673a91fd6e10', '홍은석', 'Magpie 4', '{1,2,3,4,5}', '01035274083'),
    (0, '43ff601d-bf5f-5681-90db-f78f156bdff5', '김문준', 'Crane 7', '{1,2,3,4,5}', '01099008739'),
    (0, 'd463955c-6a8d-5649-9477-fc84047644a0', '김유하', 'Owl 6', '{1,2,3,4,5}', '01029979801'),
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01042882028' and name = '김사랑' and is_demo=false limit 1), '김사랑', 'Dove 4', '{1,2,3,4,5}', '01042882028'),
    (0, '7f7abff0-5de6-574a-9679-1827dd1006e4', '김태율', 'Kite 6', '{1,2,3,4,5}', '01022053420')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 2-1호 자이/잠원
with r4 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '2-1', '자이/잠원', '고재현', '010-4522-6623', '이정현 Jessie', '010-3774-4820', '16:00', 4, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r4.id, v.seq, v.stop_time, v.address from r4, (values
    (0, '16:30', '서초구 신반포로 270 반포자이 115동 (셔틀정류장)'),
    (1, '16:30', '서초구 신반포로 270 반포자이 133동'),
    (2, '16:30', '서초구 신반포로 270 반포자이 127동'),
    (3, '16:30', '서초구 잠원로 46-38 브라운스톤 잠원'),
    (4, '16:40', '서초구 잠원로 60 신반포자이(지하)'),
    (5, '16:40', '서초구 잠원로 60 신반포자이 106동(지하)')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '7ea83049-1dd3-5973-99ac-63e403683f1d', '김주원B', 'Swan 6', '{1,2,3,4,5}', '01073821023'),
    (1, '855df5cb-02d1-521a-ae2e-d310ebcbdb18', '안제니', '3 Robin', '{1,2,3,4,5}', '01099425436'),
    (2, '3b7a7a71-123a-5974-9c82-82fe2183559f', '김예원', 'Albatross 7 / Peacock 7', '{1,2,3,4,5}', '01040782887'),
    (3, 'be8fc1ae-891b-5b6b-be58-6e838ec8eace', '신유안', '5 Nightingale', '{1,2,3,4,5}', '01027709178'),
    (4, 'f7a52319-643c-5d52-a345-7d5c1f1e2f01', '김연우A', 'Seahawk 6', '{1,2,3,4,5}', '01037018260'),
    (4, (select id from wr_students where name = '정레인' and is_demo=false limit 1), '정레인', '학교', '{1,2,3,4,5}', null),
    (5, '84d8029a-9dd0-51eb-9d77-2e4f1311961e', '최시원', 'Goldfinch 4', '{1,2,3,4,5}', '01092765875')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 2-2호 잠원2
with r5 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '2-2', '잠원2', '손창기', '010-2889-2257', '최재은 Jenny Choi', '010-6381-8903', '16:00', 5, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r5.id, v.seq, v.stop_time, v.address from r5, (values
    (0, '16:20', '서초구 잠원로8길 35 래미안신반포팰리스 106동(지하)'),
    (1, '16:20', '서초구 잠원로8길 35 래미안신반포팰리스 107동(지하)'),
    (2, '16:25', '서초구 잠원로 202-11 잠원훼미리아파트(정문)'),
    (3, '16:30', '서초구 잠원로 213-10 한강아파트')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'f5af125b-c745-52c1-ad29-7dbc35df2dd0', '임서진', 'Kite 6', '{1,2,3,4,5}', '01091458817'),
    (1, '66e6a3f8-e405-59b7-ab80-5babb71b32fb', '황아림 Arim', 'Kite 6', '{1,2,3,4,5}', '01077360569'),
    (1, '63e047dd-447f-5d17-84ed-1873d1619cd9', '최한빈', 'Starling 5', '{1,2,3,4,5}', '01095936527'),
    (2, '7af25bc5-1aa7-5b94-9323-0a7bf90f9fc7', '임서원', 'Eagle 7', '{1,2,3,4,5}', '01066002674'),
    (3, '4b86c214-d6b6-591c-af30-39f1f0931985', '김주완', 'Kite 6', '{1,2,3,4,5}', '01047654880'),
    (3, '67cfcba4-e23e-59c4-9849-784e75193a10', '김용재', 'Kite 6', '{1,2,3,4,5}', '01099117400')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 3호 반포1
with r6 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '3', '반포1', '김연운', '010-8870-5238', 'Ms Monique', '010-3990-0403', '16:00', 6, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r6.id, v.seq, v.stop_time, v.address from r6, (values
    (0, '16:30', '서초구 서초중앙로24길 57 롯데캐슬프레지던트 103동'),
    (1, '16:30', '서초구 서초중앙로24길 33 서초교대e편한세상 105동'),
    (2, '16:30', '서초구 고무래로 89 반포써밋 101동(정문)'),
    (3, '16:30', '서초구 고무래로 94 서초현대4차 201동'),
    (4, '16:30', '서초구 서초중앙로 220 반포래미안아이파크 107동'),
    (5, '16:30', '서초구 서초중앙로 220 반포래미안아이파크 108동'),
    (6, '16:30', '서초구 고무래로 35 반포리체 101동 (후문)'),
    (7, '16:30', '서초구 사평대로 240 반포미도2차 503동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '1a653d00-e0b6-5f26-a91a-2b426088dacd', '김시연', 'Starling 5', '{1,2,3,4,5}', '01023706608'),
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01033956988' and name = '도윤서' and is_demo=false limit 1), '도윤서', '학교', '{1,2,3,4,5}', '01033956988'),
    (1, '2700f4d4-ca41-5196-af2c-0af3280a3b25', '진리안', 'Seahawk 6', '{1,2,3,4,5}', '01020884556'),
    (2, 'c9a3736f-74d8-54e6-a606-e91ff0d7a81f', '강선우', 'Skylark 3', '{1,2,3,4,5}', '01097452245'),
    (2, '08a86a17-8055-5dfd-aa8d-bd1e7d311e5a', '김아인', 'Pelican 4', '{1,2,3,4,5}', '01086532837'),
    (3, '2eea316f-7227-5276-9020-fdfcbec0ccf0', '박이현', null, '{1,2,3,4,5}', '01025140900'),
    (4, 'a1a214bf-f9d3-5c5d-8514-ebe1ab1808d0', '박지안', 'Toucan 5', '{1,2,3,4,5}', '01020754171'),
    (5, 'dd9bbc78-225c-57cd-8dcd-877750e2554b', '김하진A', 'Crane 7', '{1,5}', '01053687500'),
    (6, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01088435196' and name = '곽세린' and is_demo=false limit 1), '곽세린', '학교', '{1,2,3,4,5}', '01088435196'),
    (7, '7b73718d-631b-5f52-85e7-c4f8177ed695', '조시헌', '5 Nightingale', '{1,2,3,4,5}', '01087931633')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 4호 반포2
with r7 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '4', '반포2', null, null, '김다운 Bona', '010-8350-1843', '16:00', 7, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r7.id, v.seq, v.stop_time, v.address from r7, (values
    (0, '16:25', '서초구 신반포로15길 1 래미안 원펜타스 105동'),
    (1, '16:25', '서초구 신반포로15길 1 래미안 원펜타스'),
    (2, '16:25', '서초구 신반포로15길 19, 아크로리버파크 112동'),
    (3, '16:25', '서초구 신반포로15길 19 아크로리버파크 103동'),
    (4, '16:35', '서초구 반포대로 275 래미안퍼스티지 121동'),
    (5, '16:35', '서초구 반포대로 275 래미안 퍼스티지 119동'),
    (6, '16:35', '서초구 반포대로 275 래미안 퍼스티지 117동'),
    (7, '16:35', '서초구 반포대로 275 래미안 퍼스티지 113동'),
    (8, '16:35', '서초구 반포대로 275 래미안퍼스티지 111동'),
    (9, '16:35', '서초구 반포대로 275 래미안퍼스티지 110동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '864e8bdb-113f-5b44-9509-f25aaee884ca', '김태민', 'Dove 4', '{1,2,3,4,5}', '01033871370'),
    (1, '6f79ec4d-55f1-54ec-bbb1-a92bba8e56b9', '이도현', 'Eagle 7', '{1,2,3,4,5}', '01022186878'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01071219559' and name = '연하윤' and is_demo=false limit 1), '연하윤', '학교', '{1,2,3,4,5}', '01071219559'),
    (3, 'e69245fe-1d0c-5a79-a703-6de5fff31c03', '김지수', 'Falcon 5', '{1,2,3,4,5}', '01092120714'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01045690657' and name = '김재이' and is_demo=false limit 1), '김재이', '학교', '{1,2,3,4,5}', '01045690657'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01030508681' and name = '전준백' and is_demo=false limit 1), '전준백', 'Sparrow 4', '{1,2,3,4,5}', '01030508681'),
    (5, 'b14ff7d6-325a-5b05-b89f-744323bad723', '주이솔', 'Swan 6 / Goldfinch 4', '{1,2,3,4,5}', '01022293639'),
    (6, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01090954522' and name = '정서우' and is_demo=false limit 1), '정서우', 'Robin 3', '{1,2,3,4,5}', '01090954522'),
    (7, '9b8c3d01-7cb9-52f0-a91b-cae32baad7f3', '유태우', 'Crane 7', '{1,2,3,4,5}', '01068096678'),
    (8, '1a881bca-21c8-5a98-91f8-925a6fa6e25f', '조안나', 'Owl 6', '{1,2,3,4,5}', '01035624610'),
    (9, '93060877-0d18-570d-a130-7e351b4c0bdc', '최희윤', 'Albatross 7', '{1,2,3,4,5}', '01054096694')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 4-1호 반포/이수
with r8 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '4-1', '반포/이수', '최상락', '010-5343-7011', '나정희 Jen', '010-2886-2212', '16:00', 8, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r8.id, v.seq, v.stop_time, v.address from r8, (values
    (0, '16:45', '서초구 반포대로 333 래미안 원베일리 117-2906'),
    (1, '16:45', '서초구 반포대로 333 래미안 원베일리 104-1402'),
    (2, '16:45', '서초구 반포대로 333 래미안 원베일리 113동'),
    (3, '16:45', '서초구 반포대로 333 래미안 원베일리 118동'),
    (4, '16:45', '서초구 반포대로 333 래미안 원베일리 106동'),
    (5, '16:45', '서초구 반포대로 333 래미안 원베일리 103동'),
    (6, '16:45', '서초구 반포대로 333 래미안 원베일리 105동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '6d0d3584-aed5-5997-b909-d2d475ec1784', '김서진A', 'Toucan 5', '{1,2,3,4,5}', '01071150800'),
    (1, 'c2682b65-8990-5d6f-b05d-a8f6abc003df', '허은서', 'Swan 6', '{1,2,3,4,5}', '01068860213'),
    (2, 'f1bdeb74-e13d-53e3-ab68-e777c9e0a402', '신제이', 'Toucan 5', '{1,2,3,4,5}', '01051155165'),
    (3, 'f832ac02-5cd9-5959-ab2f-13d05e3284ac', '오윤', 'Kite 6', '{1,2,3,4,5}', '01091001717'),
    (4, '9eccac18-1c2e-55b7-8c59-d91bdd396ab8', '김규민', 'Magpie 4', '{1,2,3,4,5}', '01066186277'),
    (5, '234e8385-c6f7-5b3c-ac2f-ef1d14deb339', '전우현', 'Flamingo 6/
Magpie 4', '{1,2,3,4,5}', '01034661064'),
    (6, '89d17f67-36da-535f-b458-01dedcf31739', '권태훈', '4 Goldfinch', '{1,2,3,4,5}', '01020215037')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 4-2호 반포/사당
with r9 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '4-2', '반포/사당', '전명섭', '010-4272-7120', 'Ana', '01047273470', '16:00', 9, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r9.id, v.seq, v.stop_time, v.address from r9, (values
    (0, '16:30', '서초구 신반포로23길 23 반포르엘 1차 105동'),
    (1, '16:45', '서초구 동광로 28'),
    (2, '16:50', '서초구 방배로42길 65'),
    (3, '16:52', '서초구 서초대로33길 71'),
    (4, '17:05', '서초구 서초대로34길 34 방배이편한세상')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '6b77ab9c-c612-58bb-8dd3-f3ea1585ece2', '김윤우', 'Goldfinch 4', '{1,2,3,4,5}', '01033892511'),
    (1, '0f0530f8-375f-5edc-8d67-8c53f519e89f', '이준서, 이준우, 임지효', '학교', '{3}', null),
    (2, 'd2e134c1-4a73-53e4-b51b-0da2ec5c1232', '김태은A', 'Emu 7', '{1,2,3,4,5}', '01045049451'),
    (3, '33fed48c-8e2e-537d-ba60-d39ca03cfea0', '김지원', 'Owl 6', '{1,2,3,4,5}', '01025220119'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01057032692' and name = '이서아' and is_demo=false limit 1), '이서아', '학교', '{1,2,3,4,5}', '01057032692')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 5호 반포3
with r10 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '5', '반포3', null, null, '선금희', '010-5475-8598', '16:00', 10, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r10.id, v.seq, v.stop_time, v.address from r10, (values
    (0, null, '서초구 서초대로65길 13-10 서초래미안'),
    (1, null, '서초구 서초중앙로 188 아크로비스타 B동'),
    (2, null, '서초구 서초중앙로 200 삼풍아파트 14동'),
    (3, null, '서초구 서초대로38길 12 마제스타 힐스테이트 101동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01048668100' and name = '이서준' and is_demo=false limit 1), '이서준', '학교', '{1,2,3,4,5}', '01048668100'),
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01099017999' and name = '임예나' and is_demo=false limit 1), '임예나', '학교/ Swan / Kiwi', '{1,2,3,4,5}', '01099017999'),
    (1, 'f56813ad-0305-53d3-9b13-c880060b9f00', '손재이', 'Nightingale 5', '{1,2,3,4,5}', '01033016306'),
    (2, '479b40d2-00f7-5269-a09e-b95ce1534c10', '김도율', '학교', '{1,2,3,4,5}', '01037298503'),
    (3, '96165be7-1ee1-5020-af8a-b4c93896a5ab', '최유진', 'Cardinal 5', '{1,2,3,4,5}', '01052231709')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 6호 서초1
with r11 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '6', '서초1', '김경태', '010-6251-9833', '김소희 Sohee', '010-3325-5305', '16:00', 11, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r11.id, v.seq, v.stop_time, v.address from r11, (values
    (0, '16:30', '서초구 서운로 221 래미안 서초스위트 103동'),
    (1, '16:45', '래미안 리더스원'),
    (2, '16:46', '서초구 효령로 391 서초그랑자이'),
    (3, '16:50', '서초구 효령로68길 33 서초아이파크 102동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '909b8c86-94ba-5b03-a91f-56b584d534bb', '강리안B', 'Cardinal 5', '{1,2,3,4,5}', '01065431465'),
    (1, 'c40e419d-4ae0-501e-9d2c-0fce551742d1', '김선아', 'Parrot 5', '{1,2,3,4,5}', '01024990282'),
    (1, 'd0894d8b-3f1b-56cc-a8aa-9584cebb6942', '박시아', 'Falcon 5', '{1,2,3,4,5}', '01027338991'),
    (1, '6970ab15-f722-5b49-a934-f9b8fc01682d', '박서연', 'Seahawk 6', '{1,2,3,4,5}', '01096953570'),
    (1, 'db178cc7-0553-59f1-9033-f51957d99312', '이솔', 'Magpie 4', '{1,2,3,4,5}', '01067502410'),
    (1, '2093bffa-f3ca-57e7-bf77-b238b3266070', '정주원', 'Starling 5', '{1,2,3,4,5}', '01089607552'),
    (1, 'e68d5e30-2f8c-5f30-9baf-43da0511cf44', '임지유', 'Toucan 5', '{1,2,3,4,5}', '01087742032'),
    (2, '9d6ca115-da8d-503f-b6b3-a9bb68dd89f1', '국서호', 'Wren 5', '{1,2,3,4,5}', '01092614108'),
    (2, 'bfd5bd58-08a1-59e2-b255-a2af4a90b509', '송도휘', 'Parrot 5/Robin 3', '{1,2,3,4,5}', '01052510420'),
    (2, 'e63eb5ac-f216-57b5-83ea-4394f6073899', '김선후', 'Pelican 4', '{1,2,3,4,5}', '01090025695'),
    (2, 'be3075b5-9076-5a81-accd-007d1a2f543e', '이로서', '5 Starling', '{1,2,3,4,5}', '01064790324'),
    (3, 'ab13bca2-d5c6-5ba3-b633-2de34ad6944f', '홍한울', '5 Emu/ 4 Dove', '{1,2,3,4,5}', '01089880618')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 7호 서초2
with r12 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '7', '서초2', null, null, '임지연 Winnie', '010-3934-9429', '16:00', 12, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r12.id, v.seq, v.stop_time, v.address from r12, (values
    (0, null, '서초구 강남대로 455 강남태영데시앙루브 B동'),
    (1, null, '서울시 서초구 서초4동 푸르지오 써밋'),
    (2, null, '서초구 서운로 197 롯데캐슬 106동'),
    (3, null, '서초구 서운로 107 래미안에스티지'),
    (4, null, '리더스원'),
    (5, null, '서초구 남부순환로339길 20 삼안리젠시'),
    (6, null, '서초구 효령로68길 81 서초자이 102동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '79096a64-91e4-5d19-8a1d-fbf6e7e10435', '서엘린', 'Skylark 3', '{1,2,3,4,5}', '01093106934'),
    (1, '81aa0c00-fa7c-5e10-b9ce-e6810770ca05', '이도호', 'Albatross 7', '{1,2,3,4,5}', '01053423659'),
    (1, '435033ca-281d-5072-b7a2-72763ae76598', '최윤정', 'Owl 6', '{1,2,3,4,5}', '01039192102'),
    (2, '6a9bd99b-0b08-50df-a851-3d0e2cf494c8', '이지오', 'Emu 7/ Dove 4', '{1,2,3,4,5}', '01038725326'),
    (3, '8920f7b9-7bcc-5e9f-9163-e0e1f71a8f1d', '강리안', 'Emu 7', '{1,2,3,4,5}', '01096080149'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01089722394' and name = '고진우' and is_demo=false limit 1), '고진우', '학교', '{1,2,3,4,5}', '01089722394'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01046552574' and name = '이준서' and is_demo=false limit 1), '이준서', '학교', '{1,2,3,4,5}', '01046552574'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01041143788' and name = '강예성' and is_demo=false limit 1), '강예성', '학교', '{1,2,3,4,5}', '01041143788'),
    (6, '770964d2-64a8-58e6-9945-4df58b0731e8', '편해율', '5 Cardinal', '{1,2,3,4,5}', '01064832316')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 8호 역삼/대치
with r13 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '8', '역삼/대치', '김동도', '010-3743-4125', '손희정 Nancy', '010-8513-7209', '16:00', 13, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r13.id, v.seq, v.stop_time, v.address from r13, (values
    (0, '16:20', '강남구 강남대로128길 44, 501호'),
    (1, '16:21', '강남구 학동로8길 16 현대빌라'),
    (2, '16:23', '강남구 논현동 148-18'),
    (3, '16:28', '강남구 논현로111길 39 한화꿈에그린'),
    (4, '16:31', '강남구 논현로115길 14, 필스트빌딩'),
    (5, '16:31', '강남구 논현로71길 46 블루밍코트아파트 101동'),
    (6, '16:45', '강남구 테헤란로 14길 41'),
    (7, '16:45', '강남구 도곡로13길 19 롯데캐슬노블 102동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01025422202' and name = '이온유' and is_demo=false limit 1), '이온유', 'Emu 7', '{1,2,3,4,5}', '01025422202'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01071765490' and name = '홍서형' and is_demo=false limit 1), '홍서형', '학교', '{1,2,3,4,5}', '01071765490'),
    (2, '0dc02a44-7aac-597a-9858-019c4e2d1d1d', '이지원', 'Eagle 7', '{1,2,3,4,5}', '01091941190'),
    (3, '03e8c6f0-c3d6-5ce1-b55c-0b570621150e', '김제이', '6Flamingo', '{1,2,3,4,5}', '01054819667'),
    (4, '3de1fbd6-2c83-52aa-8609-ba6103f1611d', '정소이', 'Eagle 7', '{1,2,3,4,5}', '01033888836'),
    (5, 'bb902111-6cf9-5d0e-97a0-cfa4d0599180', '양지유', '4 Goldfinch', '{1,2,3,4,5}', '01092506585'),
    (6, 'c5a424d1-2059-5213-9fa2-c3b60f60f0f5', '정윤호', '6 Owl', '{1,2,3,4,5}', '01088384188'),
    (7, 'a0bb4c09-ad7c-5059-8f39-88730c39a57a', '박세주', '학교', '{1,2,3,4,5}', '01063808798')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 9호 방배
with r14 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '9', '방배', '정홍균', '010-3690-7263', '플루 Fulu', '010-4222-1996', '16:00', 14, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r14.id, v.seq, v.stop_time, v.address from r14, (values
    (0, null, '강남구 논현동 55 스위트캐슬'),
    (1, '16:48', '서초구 사임당로17길 116 서초삼성래미안 101동'),
    (2, '16:55', '서초구 반포대로 58 서초아트자이 104동'),
    (3, '16:55', '서초구 서초 중앙로 15 현대슈퍼빌'),
    (4, '17:00', '서초구 남부순환로319길 24 씨티빌'),
    (5, '17:05', '서초구 방배로1길 9 방배신동아럭스빌 1301호'),
    (6, '17:15', '서초구 방배동 467-20'),
    (7, '17:15', '서초구 서초중앙로 63')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '7b5e734f-fabe-5dc3-a85b-7394fe799018', '박리온', 'Flamingo 6', '{1,2,3,4,5}', '01071114039'),
    (1, 'af0752ce-aabf-5726-a71b-1412434c1e6c', '신지수', 'Dove 4', '{1,2,3,4,5}', '01095007199'),
    (2, 'd28e240f-141d-562a-a947-1c4265a1232b', '윤아인', 'Goldfinch 4', '{1,2,3,4,5}', '01071210483'),
    (3, '1ce8abb7-fe94-5f43-b68b-446d9fc12f1a', '김채희', '4 Sparrow', '{1,2,3,4,5}', '01091524378'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01031764702' and name = '황이안' and is_demo=false limit 1), '황이안', '학교', '{1,2,3,4,5}', '01031764702'),
    (5, '8e260c82-9cd4-5280-80f0-25428b2e2361', '오로라', 'Nightingale 5', '{1,2,3,4,5}', '01092000130'),
    (6, '30e7eff6-31e5-5e96-8a10-044818821a71', '김로이A', 'Flamingo 6', '{1,2,3,4,5}', '01025884452'),
    (7, (select id from wr_students where name = '이준서' and is_demo=false limit 1), '이준서', '학교', '{1,5}', null)
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 9-1호 방배/내방
with r15 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '9-1', '방배/내방', '이재남', '010-9152-2429', '임주경 Luna', '010-5543-5646', '16:00', 15, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r15.id, v.seq, v.stop_time, v.address from r15, (values
    (0, null, '동작구 동작대로41길 10 미양하이츠'),
    (1, '16:40', '서초구 방배중앙로 204 방배리첸시아'),
    (2, '16:45', '원페를라 103동'),
    (3, '16:58', '원페를라 202동'),
    (4, '17:15', '동작구 사당로 300 이수 자이 101동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01021252108' and name = '김시아' and is_demo=false limit 1), '김시아', '3 Kiwi', '{1,2,3,4,5}', '01021252108'),
    (1, '42e1e2dc-57c2-5574-a6ad-f27fcae3a3c8', '양우진', 'Swan 6', '{1,2,3,4,5}', '01090690095'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01085827165' and name = '김서이' and is_demo=false limit 1), '김서이', '학교/ Albatross 7', '{1,2,3,4,5}', '01085827165'),
    (3, '76ae3e23-ea12-5998-8973-8ed330463b0d', '김유건', 'Nightingale 5', '{1,2,3,4,5}', '01036015175'),
    (4, '056b484c-32aa-54b1-be29-e6cd7b0dbe7f', '김호윤', 'Skylark 3', '{1,2,3,4,5}', '01047012888')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 9-2호 흑석
with r16 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '9-2', '흑석', '마상훈', '010-9459-6543', '김영서 Bay', '0108518-7522', '16:00', 16, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r16.id, v.seq, v.stop_time, v.address from r16, (values
    (0, '16:20', '강남구 학동로11길 13 브라운스톤'),
    (1, '16:40', '동작구 흑석한강로 27 흑석푸르지오 101동'),
    (2, '16:40', '동작구 서달로 91 흑석한강센트레빌 2차')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01041813216' and name = '유소이' and is_demo=false limit 1), '유소이', 'Emu 7/ Falcon 5', '{1,2,3,4,5}', '01041813216'),
    (1, '1f3559b3-39fa-52ac-a336-1cd462eb3bb6', '전하루', 'Starling 5', '{1,2,3,4,5}', '01071409041'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01073890228' and name = '김나율' and is_demo=false limit 1), '김나율', '학교', '{1,2,3,4,5}', '01073890228')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 10호 서래마을
with r17 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '10', '서래마을', '이만기', '010-5357-2139', '조은애 Chloe', '010-3905-1941', '16:00', 17, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r17.id, v.seq, v.stop_time, v.address from r17, (values
    (0, null, '서초구 서래로 8길 30 반포TS프리우스'),
    (1, null, '서초구 사평대로22길 51'),
    (2, null, '서초구 반포동 82-5'),
    (3, null, '서초구 동광로27길 14'),
    (4, null, '서초구 방배동 1-12 유림빌라'),
    (5, null, '서초구 동광로27길 60 프레스턴아파트'),
    (6, null, '서초구 방배동 1-58')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01047876876' and name = '김조이 Joe E' and is_demo=false limit 1), '김조이 Joe E', 'Seahawk 6', '{1,2,3,4,5}', '01047876876'),
    (1, (select id from wr_students where name = '유재이' and is_demo=false limit 1), '유재이', '학교', '{2,4,5}', null),
    (2, '320e331a-83c2-5c5e-908a-f16289320671', '이우현', 'Skylark 3', '{1,2,3,4,5}', '01054169656'),
    (3, 'ae1298b6-c75b-5711-a981-ab62f17b3a31', '김이선', 'Robin 3', '{1,2,3,4,5}', '01053842021'),
    (4, '4ce1d9e4-b30d-578a-a8ab-3a89b8e03c28', '신보석', 'Peacock 7', '{1,2,3,4,5}', '01047140729'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01063470288' and name = '임지효 Jihyo' and is_demo=false limit 1), '임지효 Jihyo', '학교', '{1,2,3,4,5}', '01063470288'),
    (6, '71afebb5-77fa-5791-9da5-a84e5786ddd4', '노희권 Harry', 'Peacock 7', '{1,2,3,4,5}', '01029092246')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 11호 용산/이태원
with r18 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '11', '용산/이태원', null, null, 'Kirsty', '010-6797-8770', '16:00', 18, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r18.id, v.seq, v.stop_time, v.address from r18, (values
    (0, null, '용산구 독서당로 111 한남더힐 124동'),
    (1, '16:30', '용산구 한남대로36길 12-13 신포빌라'),
    (2, '16:35', '용산구 한남동 809 대성 이태리하우스'),
    (3, '16:55', '용산구 녹사평대로46길 84 마운틴뷰')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'fd9482b0-9678-5e1c-b61f-9b95246e3f1d', '서아루', '7 Eagle', '{1,2,3,4,5}', '01052211275'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01092822232' and name = '이준원' and is_demo=false limit 1), '이준원', '학교', '{1,2,3,4,5}', '01092822232'),
    (2, 'f9627500-dcdc-5374-9154-cf0f5c4f11c7', '김이준B', 'Parrot 5', '{1,2,3,4,5}', '01027722018'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01053022929' and name = 'Maya' and is_demo=false limit 1), 'Maya', '학교 / 7 Emu', '{1,2,3,4,5}', '01053022929')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 12호 이촌1
with r19 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '12', '이촌1', '최상균', '010-5522-2479', '박예림 Rayna', '010-3342-2155', '16:00', 19, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r19.id, v.seq, v.stop_time, v.address from r19, (values
    (0, '16:40', '용산구 이촌로 310 첼리투스 103-1504'),
    (1, '16:40', '용산구 이촌로 310 첼리투스'),
    (2, '16:45', '용산구 이촌로64길 61 장미맨션'),
    (3, '16:50', '용산구 이촌로71길 10 한가람아파트 215동'),
    (4, '16:50', '용산구 이촌로71길 10 한가람아파트 210동'),
    (5, '16:50', '용산구 이촌로71길 10 한가람아파트 212동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'ee8de488-856a-5200-9b3a-09d670f79459', '여이서', 'Sparrow 4', '{1,2,3,4,5}', '01088967130'),
    (1, '2585f552-f883-59e8-9b63-bfb855fc2540', '허재이', '6 Owl', '{1,2,3,4,5}', '01052143962'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01028110707' and name = 'Bom(차봄)' and is_demo=false limit 1), 'Bom(차봄)', '학교', '{1,2,3,4,5}', '01028110707'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01022641478' and name = '황준호 황라원 황라윤' and is_demo=false limit 1), '황준호 황라원 황라윤', '학교', '{1,2,3,4,5}', '01022641478'),
    (4, '89c1123c-f6dd-5103-83b3-55371870cf2d', '서인우 Inu', '7 Albatross', '{1,2,3,4,5}', '01094072104'),
    (5, '89cc34cb-f620-5230-9e62-538fbb0d0b69', '김권', 'Parrot 5', '{1,2,3,4,5}', '01036863978')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 12-1호 이촌2
with r20 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '12-1', '이촌2', '강호', '010-8744-3003', '진미선 Autumn', '010-4485-1757', '16:00', 20, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r20.id, v.seq, v.stop_time, v.address from r20, (values
    (0, null, '강남구 신사동 550-12 샤인키즈댄스학원'),
    (1, null, '서초구 신반포로 20 래미안트리니원 103동'),
    (2, null, '용산구 서빙고로 413 하이페리온')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01054853269' and name = '정서우' and is_demo=false limit 1), '정서우', '학교', '{1}', '01054853269'),
    (1, '807c5472-a7df-5047-bdf3-4025398f0170', '나유안', '7 Albatross', '{2,4,5}', '01041493292'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01054853268' and name = '남가인' and is_demo=false limit 1), '남가인', '학교', '{2}', '01054853268')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 13호 마포/용산
with r21 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '13', '마포/용산', '차명신', '010-8288-6503', '서수진', '010-9263-5936', '16:00', 21, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r21.id, v.seq, v.stop_time, v.address from r21, (values
    (0, '16:30', '강남구 논현동 22 논현아파트 101동'),
    (1, '16:30', '강남구 논현동 22 논현아파트 102동'),
    (2, '16:30', '강남구 논현동 22 논현아파트 105동'),
    (3, '16:50', '용산구 서빙고로71길 32-1'),
    (4, '16:50', '용산구 녹사평대로 11길 6 아페르파크'),
    (5, '16:50', '용산구 서빙고로 35 용산시티파크 103동'),
    (6, '17:00', '용산구 서빙고로 17 센트럴파크해링턴스퀘어 101동'),
    (7, '17:00', '용산구 한강대로 69 용산푸르지오써밋'),
    (8, '17:15', '마포구 새창로 52 현대1차아파트 103동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'ae05e210-5179-5cc9-bd41-a9abfd22bb86', '김아론', 'Emu 7', '{1,2,3,4,5}', '01068021105'),
    (1, '6b3a8ca4-0d90-56da-846a-148f7a71e223', '박태린', 'Robin 3', '{1,2,3,4,5}', '01064141640'),
    (2, 'c2a23dbb-e2ea-5eae-803e-bcaafbe49294', '권사윤', 'Dove 4', '{1,2,3,4,5}', '01042064221'),
    (3, '0135e9bb-33e6-5b28-9454-e7607e85af6b', '이하은', '학교', '{1,2,3,4,5}', '01098774057'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01087223060' and name = '권태이/권주이' and is_demo=false limit 1), '권태이/권주이', '학교/유치원', '{1,2,3,4,5}', '01087223060'),
    (5, 'b6ba8f66-4252-57a2-94cc-f07b4611daca', '박제이', 'Kiwi 3', '{1}', '01039521025'),
    (6, '518436d3-31b6-537a-8cfd-99622c08395a', '정윤서', 'Kite 4', '{1,2,3,4,5}', '01087951121'),
    (7, '0edbb4d4-3aba-5c86-84e6-1e584222d4b5', '위준완', '학교', '{1,2,3,4,5}', '01049469137'),
    (8, 'c689b367-144d-5b15-a643-921095b736a0', '최온유', '학교', '{1,2,3,4,5}', '01042706404')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 14호 서울숲
with r22 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '14', '서울숲', '정재오', '010-8353-2170', '김주현 Julie', '010-4160-2474', '16:00', 22, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r22.id, v.seq, v.stop_time, v.address from r22, (values
    (0, '16:45', '성동구 독서당로 344 힐스테이트서울숲리버 107-702'),
    (1, '16:45', '성동구 독서당로 344 힐스테이트서울숲리버 106-601'),
    (2, '16:50', '성동구 금호로 15 서울숲푸르지오 106동'),
    (3, '16:55', '성동구 왕십리로 241 서울숲 더샵 103동'),
    (4, '16:55', '성동구 왕십리로 241 서울숲 더샵 101동'),
    (5, '16:55', '성동구 왕십리로 241 서울숲 더샵 102동'),
    (6, '17:05', '서울숲아이파크리버포레2차'),
    (7, '17:05', '서울숲아이파크리버포레1차')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '870abaf3-b781-5991-8d30-95948c8a5c7f', '이건우', 'Swan 6', '{1,2,3,4,5}', '01099344029'),
    (1, '8f03281d-ef59-55bc-8546-abaf1920f2fc', '류재이', 'Wren 5', '{1,2,3,4,5}', '01041961404'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01035491402' and name = '김요한' and is_demo=false limit 1), '김요한', '학교', '{1,2,3,4,5}', '01035491402'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01094763302' and name = '김태오' and is_demo=false limit 1), '김태오', 'Falcon 5', '{1,2,3,4,5}', '01094763302'),
    (4, 'b86f90ea-bff7-5503-b64b-f167d64558d7', '고유안', 'Peacock 7/ Wren 5', '{1,2,3,4,5}', '01047202881'),
    (5, '2d76bc3c-b907-56b3-a25d-8becf70d8ee7', '황희', 'Falcon 5', '{1,2,3,4,5}', '01066695364'),
    (6, 'e471a59b-a724-5ce2-8348-e99feeb7b26d', '신주오', 'Flamingo 6', '{1,2,3,4,5}', '01062065308'),
    (7, '54372a9e-0c64-55f2-9df3-d68ef097b079', '박준후', '학교', '{1,2,3,4,5}', null)
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 15호 옥수
with r23 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '15', '옥수', '김천석', '010-5496-5881', '임재인 Jane', '010-4045-8399', '16:00', 23, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r23.id, v.seq, v.stop_time, v.address from r23, (values
    (0, '16:30', '강남구 논현로160길 20 장자울아파트'),
    (1, '16:40', '성동구 매봉길 50 옥수파크힐스 114동'),
    (2, '16:40', '성동구 매봉길 50 옥수파크힐스 116동'),
    (3, '16:40', '성동구 매봉길 50 옥수파크힐스 109동'),
    (4, '16:40', '성동구 매봉길 15 래미안리버젠 108동'),
    (5, '16:40', '성동구 매봉길 50 옥수파크힐스 104동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '9a4b475b-6ba2-5c49-985d-5a014708457f', '장하은', '7Eagle', '{1,2,3,4,5}', '01087828105'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01077974865' and name = '심규민' and is_demo=false limit 1), '심규민', '5Parrot', '{1,2,3,4,5}', '01077974865'),
    (1, '1d3a18db-91f7-527c-a1bc-007ee551acc8', '권하린 Harin/ 목요일안탐', '7Crane', '{1,2,3,4,5}', '01045558103'),
    (2, '7be23091-86b8-5025-b809-6e70525782d9', '조아정', '5 Cadinal', '{1,2,3,4,5}', '01066678952'),
    (3, '3a364aa7-3a22-5423-bc4b-f29830fd2536', '배윤', '7 Eagle', '{1,2,3,4,5}', '01051744723'),
    (4, '5239cc53-e8c0-53b9-b6a8-1af36e9c5ad2', '이수호', '6 Swan', '{1,2,3,4,5}', '01049939586'),
    (5, '3f5c6155-8999-51fd-a554-5ef7d7878c54', '천리안', '5 Toucan', '{1,2,3,4,5}', '01092141532')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 16호 금호/왕십리
with r24 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '16', '금호/왕십리', '김정남', '010-8276-9292', '곽수린 Rebecca', '010-9578-0091', '16:00', 24, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r24.id, v.seq, v.stop_time, v.address from r24, (values
    (0, '16:35', '성동구 독서당로 272 금호대우아파트 106동'),
    (1, '16:42', '성동구 금호로 173 신금호파크자이 101-1201'),
    (2, '16:47', '성동구 금호로 140 금호파크힐스103-505'),
    (3, '16:47', '성동구 금호로 140 금호파크힐스 112-105'),
    (4, '16:47', '성동구 금호로 140 금호파크힐스107-1204'),
    (5, '16:50', '성동구 행당로 82 행당한진아파트 110-1204'),
    (6, '16:55', '성동구 행당로8길 8 행당두산위브')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'e3998302-d340-52ec-80f4-e4334581f5bf', '이해나', '6Owl', '{1,2,3,4,5}', '01087809091'),
    (1, 'b94cb96c-0b80-5435-b942-99184be0cb4b', '김서진B', '5Falcon', '{1,2,3,4,5}', '01045357355'),
    (2, 'db9ded9f-990e-59a4-8960-2a91c238f967', '황은우', '5Toucan', '{1,2,3,4,5}', '01093446629'),
    (3, '69cd2f12-d7ef-5a8c-9b22-3ce9d667d497', '최이서 Yiseo', '6Swan', '{1,2,3,4,5}', '01075430643'),
    (4, '2218a0db-e372-5b7a-a370-ff98fc3316b0', '이주환', '5Wren', '{1,2,3,4,5}', '01052367516'),
    (5, '20d19acf-79c4-58a2-a219-d2469a627f69', '선해린', '5wren', '{1,2,3,4,5}', '01085064477'),
    (6, '5905a9d4-6d6e-55ba-90ac-66664dfba9cb', '김승후', '학교', '{1,2,3,4,5}', '01080104949')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 16-1호 한남/금호
with r25 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '16-1', '한남/금호', '김인홍', '010-6288-0366', '양희자', '010-8651-6337', '16:00', 25, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r25.id, v.seq, v.stop_time, v.address from r25, (values
    (0, '16:30', '용산구 유엔빌리지길3길 2-24 한강빌라'),
    (1, '16:30', '용산구 유엔빌리지길 89 힐미드빌라'),
    (2, '16:30', '용산구 유엔빌리지길 62 한남리버힐 B동'),
    (3, '16:30', '용산구 한남동 15-12 코번하우스'),
    (4, '16:45', '서울시 성동구 독서당로 218'),
    (5, '16:50', '월/수/목/금: 성동구 독서당로 191 옥수극동아파트 2동 807호'),
    (6, '16:50', '성동구 옥수동 100 옥수하이츠')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '88e874a6-8b7d-53f8-8d72-92f1c8006366', '현이나', '5Wren', '{1,2,3,4,5}', '01068620669'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01090486336' and name = '김재이' and is_demo=false limit 1), '김재이', '학교', '{1,2,3,4,5}', '01090486336'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01027232046' and name = '최서아' and is_demo=false limit 1), '최서아', '학교', '{2,4}', '01027232046'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01087860409' and name = '유한솔' and is_demo=false limit 1), '유한솔', '7Albatross', '{1,2,3,4,5}', '01087860409'),
    (4, '5fbea44d-4ea7-57e4-a8c6-48c10dd25a09', '노다은', '학교', '{1,2,3,4,5}', '01097036553'),
    (5, '5c7d3358-8ba9-5091-9426-66a0db2cbb19', '문수민', '학교', '{1,3,4,5}', '01026569604'),
    (6, '5db5b723-a25f-5589-831a-1e2bc2e12fea', '정이나', 'Seahawk 6', '{1,2,3,4,5}', '01086314739')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 17호 옥수/금호
with r26 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '17', '옥수/금호', '이남희', '010-7701-2481', '김수민 Soomin', '010-2221-5965', '16:00', 26, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r26.id, v.seq, v.stop_time, v.address from r26, (values
    (0, '16:35', '성동구 독서당로 154 레미테지'),
    (1, '16:40', '성동구 매봉길 24 금호브라운스톤 103-801'),
    (2, '16:40', '성동구 독서당로40길 37 옥수어울림 101-1502'),
    (3, '17:05', '성동구 성수이로 137 성수동아이파크 107동'),
    (4, '17:10', '성동구 성수일로4길 26 서울숲 힐스테이트 101동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'fe2ed6fa-423f-52b4-976b-2e990a2ebefc', '정조이 Joie', '7Albatross', '{1,2,3,4,5}', '01092715770'),
    (1, '0d736c86-d8db-55f3-b0aa-b508e563a6ae', '이유하 Yuha', '6Flamingo', '{1,2,3,4,5}', '01097553911'),
    (2, 'a84b8fca-3d77-5e2d-8c55-6adb0b881383', '최이든 Eden', '6Flamingo', '{1,2,3,4,5}', '01037191532'),
    (3, '6d756d14-e03b-588c-9f24-a1c9fc6910ef', '조수아', '6Nightingale', '{1,2,3,4,5}', '01068617698'),
    (4, 'ed38b0ed-cad8-5258-bff7-4b844be6b2fb', '황이솔', '6Flamingo', '{1,2,3,4,5}', '01033627340'),
    (4, 'da57e30c-fe4d-5898-ab51-95d72b18a7b3', '정유하', '4Dove', '{1,2,3,4,5}', '01024913202')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 18호 서울숲2
with r27 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '18', '서울숲2', '안용해', '010-4326-4094', '이서우', '010-8318-8600', '16:00', 27, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r27.id, v.seq, v.stop_time, v.address from r27, (values
    (0, '16:50', '성동구 왕십리로 16 트리마제 104동'),
    (1, '16:55', '성동구 왕십리로 83-21 아크로 서울포레스트 A동 1902호'),
    (2, '16:55', '성동구 왕십리로 83-21 아크로 서울포레스트 A동'),
    (3, '16:55', '성동구 서울숲2길 32-14 갤러리아포레'),
    (4, '17:00', '성동구 성수일로4길 26 서울숲 힐스테이트 101동'),
    (5, '17:00', '서울숲아이파크리버포레1차')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '66b6f728-fe67-52df-a1b9-9e6b5f191317', '신이안', '3Robin', '{1}', '01065304896'),
    (1, '92634934-60df-528a-a650-4f1033070d30', '이리호', '5Wren', '{1,2,3,4,5}', '01027263698'),
    (2, 'd78f2c9f-3816-5ee5-b725-b6fb96deb81a', '조이람', '4 Goldfinch', '{1}', '01086543534'),
    (3, '5115a187-f055-5f01-a8dd-7529be875540', '정다우리', null, '{1}', '01087480724'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01091205718' and name = '주이안' and is_demo=false limit 1), '주이안', '학교', '{1,2,3,4,5}', '01091205718'),
    (3, '878add69-4d50-5f81-af7c-104467ec2867', '이태리', '6Owl', '{1,2,3,4,5}', '01085238610'),
    (4, 'd8b88aa3-3e95-5b6b-aa9f-d41f021c9b87', '박지아', '3Skylark', '{1,2,3,4,5}', '01040576575'),
    (5, 'ff2fdfc6-94a7-59c5-8e4b-d6e380553e3b', '이도후', '학교', '{1,2,3,4,5}', '01037723110')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 19호 청담1
with r28 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '19', '청담1', '박유생', '010-4132-5059', '조 향 Nicole', '010-7490-9888', '16:00', 28, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r28.id, v.seq, v.stop_time, v.address from r28, (values
    (0, '16:30', '강남구 논현동 68-4'),
    (1, '16:38', '강남구 도산대로 410'),
    (2, '16:45', '강남구 청담동 116'),
    (3, '16:45', '강남구 청담동 117-6 대우로얄카운티 3차'),
    (4, '16:45', '강남구 도산대로83길 35 대우리츠카운티'),
    (5, '16:45', '강남구 청담동 117-22 대우리츠카운티 101동'),
    (6, '16:50', '강남구 도산대로 85길 50-13 에테르노'),
    (7, '16:52', '강남구 도산대로 101길 29 청담현대 3차')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01075759503' and name = '김태윤' and is_demo=false limit 1), '김태윤', '7Peacock', '{1,2,3,4,5}', '01075759503'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01066022947' and name = '곽호율' and is_demo=false limit 1), '곽호율', '학교', '{1,2,3,4,5}', '01066022947'),
    (2, 'c832337c-0a33-5da2-88d1-887392fb0537', '이호', '7 Peacock / 4 Magpie', '{1,2,3,4,5}', '01052241024'),
    (3, '7f2e6971-f809-5fc6-a3d6-0024549784d7', '이서이', '4Magpie', '{1,2,3,4,5}', '01048110563'),
    (4, '389cf8eb-7e65-5177-b2fc-3e482f4e52fb', '정유준', '7Emu', '{1,2,3,4,5}', '01090983886'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01041737364' and name = '고서윤' and is_demo=false limit 1), '고서윤', '학교', '{1,2,3,4,5}', '01041737364'),
    (6, '4dca415c-dde8-54c5-9c66-7fe107f166d1', '황주원', '5Parrot', '{1,2,3,4,5}', '01041371006'),
    (7, '977e64bf-0c24-539a-b6c3-997090192da1', '우하린', '3Skylark', '{1,2,3,4,5}', '01042228337')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 20호 청담2
with r29 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '20', '청담2', '정재필', '010-5289-0441', '이연실 Jay', '010-5792-8379', '16:00', 29, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r29.id, v.seq, v.stop_time, v.address from r29, (values
    (0, '16:30', '강남구 언주로130길 30 동양파라곤 102동'),
    (1, '16:30', '강남구 언주로116길 6 동부센트레빌'),
    (2, '16:35', '강남구 선릉로130길 19 서광아파트 101동'),
    (3, '16:40', '강남구 선릉로130길 20 래미안삼성2차 101동'),
    (4, '16:40', '강남구 선릉로126길 22 롯데캐슬프레미어 111동'),
    (5, '16:40', '강남구 선릉로126길 22 롯데캐슬프레미어 105동'),
    (6, '16:48', '강남구 삼성로 629 센트럴아이파크'),
    (7, '16:48', '강남구 삼성로 629 센트럴아이파크 304동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'ade822bc-50d6-59c6-a965-9b33dfb98481', '이건서', '4 Sparrow', '{1,2,3,4,5}', '01075878852'),
    (1, 'd8539cd4-d607-53be-9e3e-4b175980e90e', '박지음', '학교', '{2,4,5}', '01051609872'),
    (2, '8010ddb0-0438-540b-8f7a-1d1b495f1363', '장벨라', '3 Kiwi', '{1,2,3,4,5}', '01091311651'),
    (3, '40ab1ca5-0fa3-59ff-9f46-2db790c40cc5', '박제이', '3Kiwi', '{1,2,3,4,5}', '01073122563'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01053210324' and name = '김재이' and is_demo=false limit 1), '김재이', '학교', '{1,2,3,4,5}', '01053210324'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01089084893' and name = '이서현' and is_demo=false limit 1), '이서현', '학교', '{1,2,3,4,5}', '01089084893'),
    (6, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01090878430' and name = '지수' and is_demo=false limit 1), '지수', '학교', '{1,2,3,4,5}', '01090878430'),
    (7, '0fd8286b-6c62-54a5-9229-3b2ce70a788e', '박시온', '6 Owl', '{1,2,3,4,5}', '01090860531')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 20-1호 
with r30 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '20-1', null, '송창훈', '010-2228-8793', '김현주', '010-4755-9001', '16:00', 30, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r30.id, v.seq, v.stop_time, v.address from r30, (values
    (0, '16:48', '강남구 삼성로 651 래미안 라클래시 103동'),
    (1, '16:48', '강남구 삼성로 651 래미안 라클래시 104동'),
    (2, '16:48', '강남구 학동로68길 30 중앙하이츠빌리지 102동 1904호'),
    (3, '16:54', '강남구 학동로68길 29 힐스테이트 1단지 106동'),
    (4, '16:54', '강남구 학동로68길 29 힐스테이트 1단지 102동'),
    (5, '16:55', '강남구 학동로68길 30 중앙하이츠빌리지 103동'),
    (6, '16:55', '강남구 학동로68길 29 힐스테이트 1단지 109동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'b27d6688-82f9-5196-b36d-e3c3f824c9b1', '김지유', '6Seahawk', '{1,2,3,4,5}', '01052955489'),
    (0, 'd2ec2efd-b784-574f-8401-0bcc7ddf244c', '김우주', '7Crane', '{1,2,3,4,5}', '01064902988'),
    (1, '0b3ca826-0f01-54f2-81b3-783023465b64', '정도율', '5Falcon', '{1,2,3,4,5}', '01086981559'),
    (2, 'dd9bbc78-225c-57cd-8dcd-877750e2554b', '김하진A', '7crane', '{2,3}', '01053687500'),
    (3, '162613db-86bc-5752-8ad9-fb4857040522', '원서정', '5Cardinal', '{1,2,3,4,5}', '01086067446'),
    (4, 'f24f87ed-77e6-596b-aa20-00e212c12474', '박수현', '5Cardinal', '{1,2,3,4,5}', '01087138519'),
    (4, 'ad1fccf0-ef98-5e28-9ce9-7df9b5aef05d', '이시우', '7Eagle', '{1,2,3,4,5}', '01086312431'),
    (5, '1daa8dd9-c9be-537a-b862-2bad993a2ff5', '정재이', '5Cardinal', '{1,2,3,4,5}', '01098832650'),
    (6, '3e307dcf-064f-5c0f-bf2f-9690c6efbeac', '조효리', '7Emu / 6Kite', '{1,2,3,4,5}', '01097793577')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 21호 청담3
with r31 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '21', '청담3', '김진배', '010-3799-1486', '사바 Saba', '010-9865-7550', '16:00', 31, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r31.id, v.seq, v.stop_time, v.address from r31, (values
    (0, '16:40', '강남구 삼성로147길 65 하우스에딘브로우 B동'),
    (1, '16:40', '강남구 도산대로70길25 청담2차이편한세상'),
    (2, '월, 화', '강남구 선릉로132길 41 책나무'),
    (3, '16:42', '강남구 삼성로135길 47 한신오페라하우스 101동'),
    (4, '16:47', '강남구 청담동 64-1 어퍼하우스')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'bab28d92-4cad-5d59-b3ba-338d738e9b02', '정서호 Ari', '7Albatross / 5Wren', '{1,2,3,4,5}', '01020253888'),
    (1, '7e485781-98a6-5be8-ab74-da195300dd78', '이주아', '4Pelican', '{1,2,3,4,5}', '01073367418'),
    (2, '54372a9e-0c64-55f2-9df3-d68ef097b079', '박준후', '학교', '{1,2,3,4,5}', null),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01051007847' and name = '김지민' and is_demo=false limit 1), '김지민', '학교', '{1,2,3,4,5}', '01051007847'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01066458648' and name = '강서후' and is_demo=false limit 1), '강서후', '학교', '{1,2,3,4,5}', '01066458648'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01091438857' and name = '이현우' and is_demo=false limit 1), '이현우', '7Peacock', '{1,2,3,4,5}', '01091438857')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 22호 청담4
with r32 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '22', '청담4', '박남홍', '010-5544-5003', '쉴라 Shiela', '010-2965-2756', '16:00', 32, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r32.id, v.seq, v.stop_time, v.address from r32, (values
    (0, '16:30', '강남구 삼성동 16-2 삼성힐스테이트1단지'),
    (1, '16:38', '강남구 청담동 54-5 더갤러리파크 101호'),
    (2, '16:40', '강남구 청담동 67-1 린든그로브 103동'),
    (3, '16:45', '강남구 영동대로 640 아이파크 101동'),
    (4, '16:47', '강남구 영동대로128길 15 아크로삼성'),
    (5, '16:50', '강남구 영동대로138길 12 청담자이아파트 104동'),
    (6, '16:53', '강남구 영동대로142길 21 청담마크힐스 2단지')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '9f1cea3c-9fc9-5f6a-ba38-de9c9ad9703e', '김도현', '6 Flamingo', '{1,2,3,4,5}', '01098089355'),
    (1, '30445beb-5f53-5125-bc1b-44998ffd1744', '안라엘', '5Toucan', '{1,2,3,4,5}', '01062166292'),
    (2, '6a02a3de-79f6-53db-856f-5acb57e93697', '최지아', '3Kiwi', '{1,2,3,4,5}', '01037770669'),
    (3, '5a7e1071-fc25-5de1-aa07-2beaab19d887', '김채윤', '5Parrot', '{1,2,3,4,5}', '01089169537'),
    (4, '4971c54c-4e1e-5065-8770-79012e392ddf', '이세령', '6Swan', '{1,2,3,4,5}', '01092562590'),
    (4, 'e4b8a814-260e-53d8-9f61-1f3534639e5d', '심지훈', '7Albatross', '{1,2,3,4,5}', '01098662187'),
    (5, '0d2a2cc2-9d18-5937-bff0-b054baa1632c', '장슬예', '7Crane', '{1,2,3,4,5}', '01056713304'),
    (5, 'ecfee398-0a69-508e-9443-9d7af91c4f1c', '김리하', '5Nightingale', '{1,2,3,4,5}', '01033960727'),
    (6, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01094062143' and name = '정서우' and is_demo=false limit 1), '정서우', '학교', '{1,2,3,4,5}', '01094062143')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 23호 헬리오/잠실
with r33 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '23', '헬리오/잠실', '이종근', '010-3335-1591', 'Ms.Gabbie', '010-8095-8133', '16:00', 33, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r33.id, v.seq, v.stop_time, v.address from r33, (values
    (0, null, '송파구 송파대로 345 헬리오시티 517동'),
    (1, '17:00', '송파구 백제고분로39길 21')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '6983a112-2ff7-5059-ad6a-8847def3c0b7', '박새얀', '5Starling', '{1,2,3,4,5}', '01091401924'),
    (1, '052e7779-85da-507f-b8c5-bb29bf9dcdcd', '손예진', '6Seahawk', '{1,2,3,4,5}', '01052061973')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 23-1호 잠실/송파
with r34 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '23-1', '잠실/송파', '이종진', '010-3297-6117', '정성경 Mary', '010-5871-5980', '16:00', 34, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r34.id, v.seq, v.stop_time, v.address from r34, (values
    (0, '16:50', '송파구 올림픽로 99 잠실엘스 124동'),
    (1, '16:50', '잠실 리센츠 242동'),
    (2, '16:50', '송파구 잠실로 62 트리지움 339동 (영동일고쪽정류소)'),
    (3, '17:00', '송파구 올림픽로 300 시그니엘'),
    (4, '17:00', '송파구 올림픽로35가길 9 푸르지오 월드마크 102동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01031512767' and name = '민송희' and is_demo=false limit 1), '민송희', '학교', '{1,2,3,4,5}', '01031512767'),
    (1, 'a9744c75-7e9b-57f1-9605-4449b6f52dd1', '정하준', '7Emu / 4Sparrow', '{1,2,3,4,5}', '01088682860'),
    (2, 'b6091ea9-6d4c-5ea2-b0a3-cf9ff0c2e654', '박서호', '5 Nightingale', '{1,2,3,4,5}', '01087167706'),
    (3, '2cabcb86-25e6-5ae7-b987-61469fee7b31', '김정원 Jungwon', '5 Nightingale', '{1,2,3,4,5}', '01055770033'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01092533303' and name = '심재이' and is_demo=false limit 1), '심재이', '초등', '{1,2,3,4,5}', '01092533303')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 23-2호 잠실/송파
with r35 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '23-2', '잠실/송파', '최재호', '010-3011-9353', 'Ms.Lan', '010-9818-8893', '16:00', 35, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r35.id, v.seq, v.stop_time, v.address from r35, (values
    (0, '16:45', '강남구 봉은사로111길 26 삼부 아파트 101동'),
    (1, '16:45', '종합운동장사거리 버거킹앞'),
    (2, '17:00', '송파구 올림픽로 212 갤러리아팰리스 C동'),
    (3, '17:00', '올림픽선수기자촌(올림픽공원역)')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '4b4e8d77-5043-52f7-9ce7-32a76ed8ddae', '이유성', '5 Starling', '{1,2,3,4,5}', '01096865961'),
    (1, '991bb27e-3ebd-54d5-a230-bd854f297f52', '김연수', '6 Seahawk', '{1,2,3,4,5}', '01063084993'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01021866134' and name = '서민준' and is_demo=false limit 1), '서민준', '학교', '{1,2,3,4,5}', '01021866134'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01031291495' and name = '김태리' and is_demo=false limit 1), '김태리', '7 Emu', '{1,2,3,4,5}', '01031291495')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 24호 역삼
with r36 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '24', '역삼', '방현주', '010-5242-5359', '윤지영 July', '010-3711-0841', '16:00', 36, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r36.id, v.seq, v.stop_time, v.address from r36, (values
    (0, '16:45', '강남구 언주로122길 25 두산위브 201동'),
    (1, '16:45', '강남구 언주로122길 25 두산위브 2차'),
    (2, '16:47', '강남구 언주로122길 6 현대넥서스'),
    (3, '16:48', '강남구 언주로122길 34'),
    (4, '16:49', '강남구 언주로 604 아크로힐스'),
    (5, '16:50', '강남구 선릉로115길 39'),
    (6, '16:52', '강남구 봉은사로 307 이안논현')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '4cafcde9-9f6b-5e90-a173-e0f55d2a3c02', '유주아', '5 Starling', '{1,2,3,4,5}', '01072979643'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01058268910' and name = '강여명' and is_demo=false limit 1), '강여명', '학교', '{1,2,3,4,5}', '01058268910'),
    (2, '3878d7ed-779d-51bc-aa0e-39dbf12a9c8d', '어연우', '6 Seahawk / 4 Pelican', '{1,2,3,4,5}', '01044533566'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01072398383' and name = '이온유' and is_demo=false limit 1), '이온유', '학교', '{1,2,3,4,5}', '01072398383'),
    (4, 'de01e92f-eeb4-5bf0-bb58-78cb73c53088', '박이준', '7 Crane', '{1,2,3,4,5}', '01094200601'),
    (5, 'e9286153-3399-59d4-a7ed-9706540408a7', '조아윤', '6 Kite', '{1,2,3,4,5}', '01080803546'),
    (6, 'fca149ac-965d-5739-a357-9a8a04f03d91', '최유주', '5 Parrot', '{1,2,3,4,5}', '01065922468')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 25호 도곡
with r37 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '25', '도곡', '송창석', '010-5347-2433', '한지원 Jane', '010-4877-5208', '16:00', 37, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r37.id, v.seq, v.stop_time, v.address from r37, (values
    (0, '16:30', '강남구 테헤란로52길 16 테헤란아이파크 101동'),
    (1, '16:35', '강남구 테헤란로44길 26 강남센트럴아이파크 104동'),
    (2, '16:35', '강남구 역삼동 713-11 역삼아이파크 202동'),
    (3, '16:35', '강남구 역삼동 713-11 역삼아이파크'),
    (4, '16:40', '강남구 역삼로 306 개나리래미안 105동'),
    (5, '16:30', '강남구 역삼로 314 개나리푸르지오'),
    (6, '16:45', '강남구 언주로30길 26 타워팰리스 G'),
    (7, '16:45', '강남구 언주로30길 56 타워팰리스 E동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '859bce68-d92a-5691-8605-356b62789d1a', '신예원', '4 Pelican', '{1,2,3,4,5}', '01071764730'),
    (1, '9aa3cdf0-a093-58fa-b61e-feed69190ee3', '홍도경', '3 Skylark', '{1,2,3,4,5}', '01091201025'),
    (2, 'c231d124-6c45-53b4-a19a-5b4601df4702', '정아인', '4 Dove', '{1,2,3,4,5}', '01040031262'),
    (3, 'ea67ab4f-c774-563a-96d5-42998a3a7497', '허정원', '7 Emu', '{1,2,3,4,5}', '01062670125'),
    (4, '606ed8ba-3dfa-5b75-a349-ac93a6abfa59', '유아린', '6 Flamingo', '{1,2,3,4,5}', '01043403303'),
    (5, '31ad5fe5-2b32-5ca5-800e-515a620adb07', '리아채터스', '4 Magpie', '{1,2,3,4,5}', '01089805816'),
    (6, '05c69c5d-3732-5a52-ab1b-7a961158d019', '오석', '5 Nightingale', '{1,2,3,4,5}', '01090076726'),
    (7, 'e3555f9e-4b60-5d45-ab2d-7ac545bdfbff', '김태은', '5 Wren', '{1,2,3,4,5}', '01091755822'),
    (7, '7a9f7871-a110-56df-9793-3e4628970d66', '이해린', '3 Robin', '{1,2,3,4,5}', '01027790000')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 26호 양재
with r38 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '26', '양재', '주의식', '010-3129-6250', '이소영', '010-9045-5200', '16:00', 38, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r38.id, v.seq, v.stop_time, v.address from r38, (values
    (0, null, '강남구 논현동 222'),
    (1, null, '강남구 논현로 213 역삼럭키아파트 103-908'),
    (2, null, '강남구 남부순환로373길 3 도곡지웰카운티1차'),
    (3, null, '강남구 도곡동 153-2 현대밸라하우스 8층'),
    (4, null, '강남구 도곡로 217 (카렉스앞 횡단보도)')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '09167fa3-762a-50fe-a78a-7072146f8520', '바이시우', '3 Kiwi', '{1,2,3,4,5}', '01077598878'),
    (1, '581de5f6-6e31-5179-88c4-0c7c71c51bab', '강수빈', '7 Crane / 5 Starling', '{1,2,3,4,5}', '01027258758'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01088754490' and name = '전지완' and is_demo=false limit 1), '전지완', '학교', '{1,2,3,4,5}', '01088754490'),
    (3, '4af53e42-9c91-510a-8c7d-4553ca7bed64', '박윤솔', '7 Eagle', '{1,2,3,4,5}', '01022505702'),
    (4, '7cabab1a-529c-589a-8ad3-1efccf7862da', '이지원', '학교', '{5}', '01072885702')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 26-1호 삼성/도곡
with r39 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '26-1', '삼성/도곡', '류강희', '010-9043-4589', 'Alyssa', '010-3812-1828', '16:00', 39, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r39.id, v.seq, v.stop_time, v.address from r39, (values
    (0, null, '강남구 삼성로 403 대치사거리'),
    (1, '17:40', '강남구 영동대로65길 5'),
    (2, '16:43', '강남구 대치동 932-21'),
    (3, '16:45', '강남구 대치동 923-23'),
    (4, '16:48', '강남구 도곡로57길 12 역삼아이파크 2차'),
    (5, '16:55', '강남구 언주로30길 21 아카데미스위트 A동'),
    (6, '16:55', '강남구 언주로30길 56 타워팰리스 C동'),
    (7, '16:55', '강남구 언주로30길 56 타워팰리스 E동')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'd8539cd4-d607-53be-9e3e-4b175980e90e', '박지음', '학교', '{1,3}', '01051609872'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01031512767' and name = '민송희, 김재이' and is_demo=false limit 1), '민송희, 김재이', '학교', '{2}', '01031512767'),
    (2, '99849e20-87fa-5770-a2ca-45b8d7d9d6e0', '이세나', '7 Albatross', '{1,2,3,4,5}', '01028162079'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01047396231' and name = '김도은' and is_demo=false limit 1), '김도은', '학교', '{1,2,3,4,5}', '01047396231'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01077222879' and name = '이한범' and is_demo=false limit 1), '이한범', '학교', '{1,2,3,4}', '01077222879'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01058130000' and name = '원세빈' and is_demo=false limit 1), '원세빈', '학교', '{1,2,3,4,5}', '01058130000'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01027489949' and name = '권수호' and is_demo=false limit 1), '권수호', '학교', '{1,2,3,4,5}', '01027489949'),
    (6, '6c82c32d-5da7-5b81-9c63-3ef2582c5e3c', '오유준', '3 Kiwi', '{1,2,3,4,5}', '01090907199'),
    (7, 'ca415a14-83b6-5c66-a3fc-a381d3db0736', '윤벨라', '3 Skylark', '{1,2,3,4,5}', '01036002252')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 26-2호 삼성/도곡
with r40 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '26-2', '삼성/도곡', '임남혁', '010-5237-3848', '조이 Joy', '010-6480-0499', '16:00', 40, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r40.id, v.seq, v.stop_time, v.address from r40, (values
    (0, null, '강남구 삼성동 65-4 상지리츠빌 카일룸 4차'),
    (1, '16:32', '강남구 삼성로112길 31-14'),
    (2, '16:40', '강남구 학동로 607 청담르엘 105동'),
    (3, '16:40', '강남구 학동로 607 청담르엘'),
    (4, '16:50', '광진두산위브파크')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '60a8ffc0-0806-5575-904d-61d4fd92f8fc', '박지우', '3 Skylark', '{1,2,3,4,5}', '01091401471'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01086868118' and name = '황시원' and is_demo=false limit 1), '황시원', '학교', '{1,2,3,4,5}', '01086868118'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01087542684' and name = '이예나' and is_demo=false limit 1), '이예나', '학교', '{1,2,3,4,5}', '01087542684'),
    (3, (select id from wr_students where name = '고이건' and is_demo=false limit 1), '고이건', '학교', '{1,2,3,4,5}', null),
    (3, 'c000f22b-7773-50c8-a84c-9c6a7a10000d', '박세훈', '5 Parrot', '{1,2,3,4,5}', '01080130403'),
    (3, 'a7e0ac41-fa9c-500c-b2ce-02bc04263868', '염시후', '6 Flamingo', '{1,2,3,4,5}', '01036851459'),
    (4, 'da68d0b2-82f9-5940-bccb-96c4937361b8', '이서온', '6 Seahawk', '{1,2,3,4,5}', '01047663896')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 27호 개포/일원
with r41 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '27', '개포/일원', '박광득', '010-3256-6014', '양영승 Cindy', '010-2397-3815', '16:00', 41, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r41.id, v.seq, v.stop_time, v.address from r41, (values
    (0, '16:35', '강남구 논현로64길 7 역삼청소년센터'),
    (1, '16:35', '강남구 개포로 264 개포래미안포레스트 116동'),
    (2, '16:50', '디에이치아이파크퍼스티어 아파트 143동'),
    (3, '16:50', '강남구 삼성로 14 개포자이 프레지던스'),
    (4, '17:00', '강남구 영동대로 16 상록스타힐스아파트')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01042568836' and name = '이예온' and is_demo=false limit 1), '이예온', '학교', '{1,2,4}', '01042568836'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01093896648' and name = '임하임' and is_demo=false limit 1), '임하임', '학교', '{1,2,3,4,5}', '01093896648'),
    (2, '639c264b-6c00-5245-b7cd-53fbcf8aea3f', '강로완', '5 Flacon', '{1,2,3,4,5}', '01023260354'),
    (3, '923d3262-6a66-52a7-a96d-453fb1844325', '김연우', '6 Kite', '{1,2,3,4,5}', '01027751534'),
    (4, 'bb200eb5-0126-5aaa-b25c-6df48366baee', '강하영', '학교', '{1,2,3,4,5}', '01028390180')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 28호 대치
with r42 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '28', '대치', '정재용', '010-5396-8109', null, null, '16:00', 42, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r42.id, v.seq, v.stop_time, v.address from r42, (values
    (0, '16:30', '한티역 5, 6번 출구'),
    (1, '16:30', '강남구 삼성로51길 25 대치sk뷰'),
    (2, '16:45', '강남구 영동대로 210 쌍용아파트 5동'),
    (3, '16:46', '강남구 영동대로 210 쌍용아파트 3동'),
    (4, '16:50', '강남구 영동대로 210 쌍용아파트 상가'),
    (5, '16:50', '강남구 영동대로 221')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01042568836' and name = '이예온' and is_demo=false limit 1), '이예온', '학교', '{3,5}', '01042568836'),
    (1, '43f3eef3-3ed1-5880-957c-03ffa6ad89a1', '강이준', '3 Skylark', '{1,2,3,4,5}', '01099749592'),
    (2, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01091364946' and name = '문준연 Joon' and is_demo=false limit 1), '문준연 Joon', '학교  / 6 Kite', '{1,4,5}', '01091364946'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01037008489' and name = '이예온' and is_demo=false limit 1), '이예온', '5 Flacon', '{1,3,5}', '01037008489'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01077222879' and name = '이한범' and is_demo=false limit 1), '이한범', '학교', '{5}', '01077222879'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01054853270' and name = '남가인' and is_demo=false limit 1), '남가인', '학교', '{2}', '01054853270')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 29호 건대/광장동
with r43 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '29', '건대/광장동', '이기수', '010-8996-6170', '추수미 Sumi', '010-8212-5527', '16:00', 43, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r43.id, v.seq, v.stop_time, v.address from r43, (values
    (0, '16:45', '광진구 능동로4길 40 이튼리버타워5차 B동'),
    (1, '16:52', '광진구 아차산로 262 더샾스타시티 D동'),
    (2, '16:52', '광진구 아차산로 262 더샾스타시티'),
    (3, '17:03', '광진구 아차산로 549 광장현대파크빌 1007동'),
    (4, '17:03', '광진구 아차산로 453 미술학원'),
    (5, '17:03', '광장동 월드메르디앙 1차')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, 'f33fe061-3c8a-5b5e-afdb-dbf75bbe59d0', '김리아', '7 Peacock', '{1,2,3,4,5}', '01051612510'),
    (1, '76f0a90e-acf7-5065-983a-4846cb3f61a2', '홍리아', '4 Dove', '{1,2,3,4,5}', '01089221076'),
    (2, 'ee84179a-c452-5046-b45d-be446ef889b0', '김이준', '7 Crane / 5 Toucan', '{1,2,3,4,5}', '01028500064'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01032006207' and name = '노유겸' and is_demo=false limit 1), '노유겸', '학교', '{1,2,3,4,5}', '01032006207'),
    (4, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01032006207' and name = '노유겸' and is_demo=false limit 1), '노유겸', '학교', '{1,2,3,4,5}', '01032006207'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01025288616' and name = '조여람' and is_demo=false limit 1), '조여람', null, '{1,2,3,4,5}', '01025288616')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 30호 압구정/청담
with r44 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '30', '압구정/청담', '김경갑', '010-5323-9980', 'Carla', '010-6869-8992', '16:00', 44, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r44.id, v.seq, v.stop_time, v.address from r44, (values
    (0, '16:25', '강남구 압구정로42길 78 압구정하이츠파크 B동'),
    (1, '16:30', '압구정 현대 91동'),
    (2, '16:35', '강남구 압구정로 347 한양아파트 25동'),
    (3, '16:45', '강남구 압구정로75길 27 청담101 A동'),
    (4, '16:45', '강남구 청담동 102-2 연세힐하우스'),
    (5, '16:45', '강남구 청담동 116-2 두산빌라')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01068892937' and name = '이아인' and is_demo=false limit 1), '이아인', '학교', '{1,2,3,4,5}', '01068892937'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01051483885' and name = '한우영' and is_demo=false limit 1), '한우영', '학교', '{1,2,3,4,5}', '01051483885'),
    (2, 'b9affe45-b320-5375-913c-54116114f714', '유태정', '4 Pelican', '{1,2,3,4,5}', '01071533903'),
    (3, 'd2035d2c-fe0a-51c2-bb85-150a97ad6127', '장유안', '4 Sparrow', '{1,2,3,4,5}', '01094356770'),
    (4, 'ffeccab8-58fe-5012-a10b-51110e112f66', '김이안', '5 Falcon', '{1,2,3,4,5}', '01048277754'),
    (5, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01087609264' and name = '김리안' and is_demo=false limit 1), '김리안', '학교', '{1,2,3,4,5}', '01087609264')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 30-1호 압구정
with r45 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '30-1', '압구정', '함오식', '010-5286-5463', '한혜정 Grace', '010-2934-3661', '16:00', 45, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r45.id, v.seq, v.stop_time, v.address from r45, (values
    (0, null, '압구정 현대 25동'),
    (1, '16:32', '압구정 현대 63동'),
    (2, '16:35', '압구정 현대 116동'),
    (3, '16:35', '압구정 현대 203동'),
    (4, '16:35', '압구정 현대 211동'),
    (5, '16:35', '호산여성병원'),
    (6, '16:35', '강서면옥')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01047859973' and name = '백서아' and is_demo=false limit 1), '백서아', '학교', '{1,2,3,4,5}', '01047859973'),
    (0, 'a2fe9bc2-7062-56eb-b392-6d9e854136bc', '홍지아', '4 Magpie', '{1,2,3,4,5}', '01089816856'),
    (0, 'ec9cfff5-29d5-59b5-824d-1976d5a20275', '배아린(4월 등원)', '5 Nightingale', '{1,2,3,4,5}', '01087025593'),
    (1, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01091736033' and name = '이서아' and is_demo=false limit 1), '이서아', '5 Nightingale', '{1,2,3,4,5}', '01091736033'),
    (2, 'a2f9a7bf-d7ec-5f73-8908-8091b1d6cba6', '이하윤', '4 Pelican', '{1,2,3,4,5}', '01066344085'),
    (3, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01065386529' and name = '이라엘' and is_demo=false limit 1), '이라엘', '학교', '{1,2,3,4,5}', '01065386529'),
    (4, '84b9b76b-c5fd-5185-a426-dc78915b2a9d', '정승준', '5 Cardinal', '{1,2,3,4,5}', '01031360969'),
    (5, 'a9c86dd3-ed55-53bb-ac05-76eb04a4a58d', '이세린', '학교', '{5}', null),
    (6, 'fa7213df-c7d5-5469-abeb-0ec636dd86d0', '박진우', '학교', '{4}', '01094669779')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 31호 건대
with r46 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '31', '건대', '손창기', '010-2889-2257', null, null, '16:00', 46, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r46.id, v.seq, v.stop_time, v.address from r46, (values
    (0, null, '광진두산위브파크'),
    (1, null, '중/고등학생')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, (select id from wr_students where regexp_replace(coalesce(parent_phone,''),'[^0-9]','','g') = '01029006454' and name = '강하늘' and is_demo=false limit 1), '강하늘', '학교', '{1,2,3,4,5}', '01029006454'),
    (0, '5b2ba05f-44f0-51e8-97f5-dbfc49f323ab', '제이콥', '학교', '{1,2,3,4,5}', null),
    (1, 'a28a6c4a-398e-5ee3-b2eb-bcaa65c19cb6', '장하영', '학교', '{1,2,3,4,5}', null)
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

-- 하원 31-1호 중구
with r47 as (
  insert into shuttle_routes (direction, term, route_no, name, driver_name, driver_phone, teacher_name, teacher_phone, depart_time, sort_order, active)
  values ('하원', '정규학기', '31-1', '중구', '이종근', '010-3335-1591', '김종희', '010-2991-3806', '16:00', 47, true)
  returning id
), s as (
  insert into shuttle_stops (route_id, seq, stop_time, address)
  select r47.id, v.seq, v.stop_time, v.address from r47, (values
    (0, '16:50', '중구 정동길 21-31 정동상림원 B동'),
    (1, '16:50', '종로구 사직로8길 4 광화문스페이스본 1단지'),
    (2, '16:50', '종로구 사직로8길 4 광화문스페이스본 2단지 놀이터앞'),
    (3, '16:50', '중구 통일로 102, 바비엔스위트'),
    (4, '19:28', '종로구 사직로8길 4 광화문스페이스본 1단지 개구리 연못'),
    (5, '19:35', '종로구 송월길99 경희궁자이2단지 후문')
  ) as v(seq, stop_time, address) returning id, seq
)
insert into shuttle_assignments (stop_id, student_id, student_name_raw, class_raw, weekdays, guardian_phone)
select s.id, a.sid::uuid, a.name, a.klass, a.wd::int[], a.phone from s, (values
    (0, '42ef9403-70ba-5865-8c46-474960df2f49', '심규원', '4 Dove', '{1,2,3,4,5}', '01035649153'),
    (1, '145c1a75-442d-5ed8-9d2e-845ff1cc1d8f', '민경건', '학교', '{1,2,3,4,5}', null),
    (2, 'fa7213df-c7d5-5469-abeb-0ec636dd86d0', '박진우', '학교', '{1,2,3,4,5}', '01094669779'),
    (2, 'fa7213df-c7d5-5469-abeb-0ec636dd86d0', '박진우', '학교', '{1,2,3,4,5}', '01094669779'),
    (3, 'b6fe310d-f8d5-56db-a233-1f26d123d8f5', 'Maria', '학교', '{1,2,3,4,5}', null),
    (3, 'b6fe310d-f8d5-56db-a233-1f26d123d8f5', 'Maria', '학교', '{1,2,3,4,5}', null),
    (4, '145c1a75-442d-5ed8-9d2e-845ff1cc1d8f', '민경건', '학교', '{1,2,3,4,5}', null),
    (5, '1dcf6a38-ccbf-5de9-ae7d-3046889e104d', '정민호', '학교', '{1,2,3,4,5}', '01091876548')
  ) as a(seq, sid, name, klass, wd, phone) where s.seq = a.seq;

commit;