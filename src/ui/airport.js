export function populateAirportUI(airport, catalog, onSelect) {
  const text = (selector, value) => {
    document.querySelector(selector).textContent = value;
  };
  document.title = "Ground Control | " + airport.name;
  document.querySelector('meta[name="description"]').content =
    "Airport ground control on " +
    airport.name +
    "'s real taxiway network. A browser-only game.";
  document
    .getElementById("map")
    .setAttribute("aria-label", airport.name + " airport map");
  text(
    ".map-heading .eyebrow",
    `${airport.id} / ${airport.country.toUpperCase()}`,
  );
  text(".map-heading h1", airport.name);
  text("#weather-conditions", airport.scenario.weather.conditions);
  text("#weather-wind", airport.scenario.weather.wind);
  text(".icao", airport.id);
  text(".airport-name", airport.name);
  text(".runway-symbol", airport.runway);
  text(".frequency", airport.operations.frequency);
  text("#map-loading", "Loading " + airport.name + " airfield...");
  const attribution = document.querySelector(".map-footer a");
  attribution.textContent = "© " + airport.source.name;
  attribution.href = airport.source.url;
  const list = document.getElementById("airport-choices");
  list.replaceChildren();
  for (const item of catalog) {
    const button = document.createElement("button");
    button.className = "airport-choice";
    const code = document.createElement("span");
    code.className = "catalog-code";
    code.textContent = item.iata;
    const details = document.createElement("span");
    for (const [tag, content] of [
      ["strong", item.name],
      ["small", `${item.id} · ${item.country}`],
      [
        "small",
        `Runway ${item.activeRunway.label} · ${item.stands.length} playable stands`,
      ],
    ]) {
      const element = document.createElement(tag);
      element.textContent = content;
      details.append(element);
    }
    button.append(code, details);
    if (item.id === airport.id) {
      const icon = document.createElement("i");
      icon.dataset.lucide = "check";
      button.append(icon);
    }
    button.onclick = () => onSelect(item);
    list.append(button);
  }
  text(
    ".catalog-note",
    `${catalog.length} airport${catalog.length === 1 ? "" : "s"} available.`,
  );
  text("#airport-dialog a", "Airport data · " + airport.source.license);
}
