const URL = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status}`);
  }

  return res.json();
}

function printShort(label, value) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(value, null, 2).slice(0, 4000));
}

async function main() {
  const data = await fetchJson(URL);

  console.log("Top keys:", Object.keys(data));

  console.log("sets is array:", Array.isArray(data.sets));
  console.log(
    "sets length:",
    Array.isArray(data.sets) ? data.sets.length : "not array",
  );

  console.log("setData is array:", Array.isArray(data.setData));
  console.log(
    "setData length:",
    Array.isArray(data.setData) ? data.setData.length : "not array",
  );

  if (Array.isArray(data.sets)) {
    printShort(
      "sets keys/sample",
      data.sets.map((set) => ({
        id: set.id,
        number: set.number,
        name: set.name,
        keys: Object.keys(set),
        championsLength: set.champions?.length,
        traitsLength: set.traits?.length,
      })),
    );
  }

  if (Array.isArray(data.setData)) {
    printShort(
      "setData keys/sample",
      data.setData.map((set) => ({
        id: set.id,
        number: set.number,
        name: set.name,
        keys: Object.keys(set),
        championsLength: set.champions?.length,
        unitsLength: set.units?.length,
        traitsLength: set.traits?.length,
      })),
    );
  }

  const setsArray = Array.isArray(data.sets)
    ? data.sets
    : Object.values(data.sets || {});

  const setDataArray = Array.isArray(data.setData)
    ? data.setData
    : Object.values(data.setData || {});

  const allSets = [...setsArray, ...setDataArray];

  const set17 = allSets.find((set) => {
    return (
      String(set.number) === "17" ||
      String(set.id || "").includes("17") ||
      String(set.name || "").includes("17")
    );
  });

  printShort("set17 sample", {
    id: set17?.id,
    number: set17?.number,
    name: set17?.name,
    keys: set17 ? Object.keys(set17) : null,
    firstChampion: set17?.champions?.[0] || set17?.units?.[0],
    firstTrait: set17?.traits?.[0],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
