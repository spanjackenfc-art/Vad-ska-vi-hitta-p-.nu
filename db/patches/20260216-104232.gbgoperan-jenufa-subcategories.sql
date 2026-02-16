-- Goal:
-- 1) Opera is a subcategory (NOT main category).
-- 2) "Prova på" should not mix with performances -> keep category as ovrigt, mark as prova_pa.

-- Targets (from audit):
-- Jenůfa (performance): ec2cc450-edab-4384-83ed-eef9ed0d48ab
-- Prova på Jenůfa:     e188b9b2-0131-46e8-aef1-c9578d7b81d9

-- Pre-check
select id, title, category, subcategory
from events
where id in (
  'ec2cc450-edab-4384-83ed-eef9ed0d48ab',
  'e188b9b2-0131-46e8-aef1-c9578d7b81d9'
);

-- Patch
update events
set subcategory = 'opera'
where id = 'ec2cc450-edab-4384-83ed-eef9ed0d48ab';

update events
set subcategory = 'prova_pa'
where id = 'e188b9b2-0131-46e8-aef1-c9578d7b81d9';

-- Post-check
select id, title, category, subcategory
from events
where id in (
  'ec2cc450-edab-4384-83ed-eef9ed0d48ab',
  'e188b9b2-0131-46e8-aef1-c9578d7b81d9'
);
