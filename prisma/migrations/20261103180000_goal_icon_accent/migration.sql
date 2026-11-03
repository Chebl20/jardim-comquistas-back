-- Ícone e cor da meta, preenchidos a partir do conquestType.
ALTER TABLE "Goal" ADD COLUMN "icon" TEXT;
ALTER TABLE "Goal" ADD COLUMN "accentColor" TEXT;

UPDATE "Goal" AS g
SET
  "icon" = CASE src.folded
    WHEN 'corpo' THEN 'fitness_center'
    WHEN 'mente' THEN 'psychology'
    WHEN 'familia' THEN 'family_restroom'
    WHEN 'trabalho' THEN 'work'
    WHEN 'social' THEN 'groups'
    WHEN 'financeiro' THEN 'attach_money'
    WHEN 'espiritual' THEN 'self_improvement'
    WHEN 'hobby_lazer' THEN 'palette'
    WHEN 'hobby' THEN 'palette'
    WHEN 'lazer' THEN 'palette'
    WHEN 'saude' THEN 'health_and_safety'
    ELSE 'eco'
  END,
  "accentColor" = CASE src.folded
    WHEN 'corpo' THEN 'garden-green'
    WHEN 'saude' THEN 'garden-green'
    WHEN 'mente' THEN 'accent-sky'
    WHEN 'espiritual' THEN 'accent-sky'
    WHEN 'familia' THEN 'accent-pink'
    WHEN 'social' THEN 'accent-pink'
    WHEN 'hobby' THEN 'accent-pink'
    WHEN 'lazer' THEN 'accent-pink'
    WHEN 'hobby_lazer' THEN 'accent-pink'
    WHEN 'trabalho' THEN 'accent-autumn'
    WHEN 'financeiro' THEN 'accent-autumn'
    ELSE 'garden-green'
  END
FROM (
  SELECT
    id,
    lower(
      translate(
        replace(replace(btrim("conquestType"), ' ', '_'), '-', '_'),
        'áàãâäéèêëíìîïóòôõöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )
    ) AS folded
  FROM "Goal"
) AS src
WHERE g.id = src.id;

ALTER TABLE "Goal" ALTER COLUMN "icon" SET DEFAULT 'eco';
ALTER TABLE "Goal" ALTER COLUMN "icon" SET NOT NULL;
ALTER TABLE "Goal" ALTER COLUMN "accentColor" SET DEFAULT 'garden-green';
ALTER TABLE "Goal" ALTER COLUMN "accentColor" SET NOT NULL;
