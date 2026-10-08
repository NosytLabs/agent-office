/* Room toys use visual state; the observer remains the source of work activity. */
"use strict";
(() => {
  const hint =
    "Click an agent or an object. Try the lamp, coffee cart or arcade.";
  let switchingLights = false;
  const reactions = {
    coffee: "Fresh coffee. Take a moment.",
    cooler: "A little water break.",
    monstera: "The monstera catches a few drops.",
    succulent: "Just a sip for the succulent.",
    planter: "A drink for the planter.",
    fern: "The fern perks up.",
    robot: "Hello from the desk robot.",
    terrarium: "The fireflies are awake.",
    sofa: "A quiet spot for a breather.",
  };
  function available(kind) {
    return (
      (settings.decorations &&
        ["coffee", "cooler", "monstera", "sofa"].includes(kind)) ||
      settings.furniture.some((item) => item.kind === kind)
    );
  }
  async function lights() {
    if (!settingsReady || switchingLights) return;
    switchingLights = true;
    sync();
    const on = settings.room_lights === false;
    const saved = await updateSetting("room_lights", on);
    switchingLights = false;
    sync();
    if (saved) toast(on ? "Room lights on." : "Room lights off.");
  }
  function react(kind, target) {
    if (!scene.reactToProp(kind, target)) {
      toast("Place this object in the room to try it.");
      return;
    }
    toast(reactions[kind]);
  }
  function interact(kind, target) {
    if (kind === "lamp" || kind === "light_switch") lights();
    else if (kind === "arcade") window.officeArcade?.open();
    else if (kind === "FISH_TANK") window.openAquarium?.();
    else if (kind === "jukebox" || kind === "recordplayer")
      window.officeJukebox?.open();
    else if (Object.hasOwn(reactions, kind)) react(kind, target);
    else if (kind === "taskterminal") {
      if (scene.taskRunner?.enabled) window.officeTaskRunner?.open();
      else {
        taskMode = "reported";
        openSheet("sheet-tasks");
      }
    } else if (["whiteboard", "focusbooth", "statusbeacon"].includes(kind)) {
      taskMode = "activity";
      openSheet("sheet-tasks");
    } else if (kind === "petbed") {
      openSheet("sheet-settings");
      $("pet-name-form").scrollIntoView({ block: "center" });
    } else if (kind === "server") openSheet("sheet-floor");
    else if (kind === "printer") {
      eventMode = "latest";
      eventSession = null;
      openSheet("sheet-events");
    } else if (kind === "filingcabinet") {
      eventMode = "history";
      eventSession = null;
      eventPageSize = 100;
      openSheet("sheet-events");
    }
  }
  const actions = [
    ["Arcade", () => window.officeArcade?.open()],
    ["Aquarium", () => window.openAquarium?.()],
    ["Jukebox", () => window.officeJukebox?.open()],
    ["Open task terminal", () => interact("taskterminal"), "taskterminal"],
    ["Switch room lights", lights],
    ["Brew coffee", () => floorReaction("coffee"), "coffee"],
    ["Pour water", () => floorReaction("cooler"), "cooler"],
    ["Water the plants", waterPlants, "plants"],
    ["Say hello to the robot", () => floorReaction("robot"), "robot"],
    ["Wake the fireflies", () => floorReaction("terrarium"), "terrarium"],
    ["Take a break", () => floorReaction("sofa"), "sofa"],
    ["Pet the orange cat", () => scene.petCat("cat")],
    ["Pet the black cat", () => scene.petCat("blackcat")],
  ];
  function floorReaction(kind) {
    closeSheets();
    scene.draw(0);
    interact(kind);
  }
  function waterPlants() {
    closeSheets();
    scene.draw(0);
    const plants = scene.propHits.filter((item) =>
      ["monstera", "succulent", "planter", "fern"].includes(item.kind),
    );
    for (const plant of plants) scene.reactToProp(plant.kind, plant);
    toast(
      plants.length
        ? "A little water for the plants."
        : "Place a plant in the room to water it.",
    );
  }
  for (const [label, action, kind] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.dataset.activity = label;
    if (kind) button.dataset.propKind = kind;
    button.onclick = action;
    $("room-actions").append(button);
  }
  function sync() {
    const lit = settings.room_lights !== false;
    for (const button of [
      $("room-lights"),
      $("room-actions").querySelector('[data-activity="Switch room lights"]'),
    ]) {
      if (!button) continue;
      button.textContent = lit ? "Lights on" : "Lights off";
      button.setAttribute("aria-pressed", String(lit));
      button.title = lit ? "Turn room lights off" : "Turn room lights on";
      button.disabled = !settingsReady || switchingLights;
    }
    for (const button of $("room-actions").children) {
      const kind = button.dataset.propKind;
      if (kind) {
        button.disabled =
          kind === "plants"
            ? !["monstera", "succulent", "planter", "fern"].some(available)
            : !available(kind);
        button.title = button.disabled
          ? "Place this object in the room first"
          : "";
      }
      const black = button.dataset.activity === "Pet the black cat";
      if (black || button.dataset.activity === "Pet the orange cat") {
        button.disabled =
          !settings.decorations ||
          settings.show_pets === false ||
          (black && !progress?.cosmetics?.includes("gitcat"));
        button.title = !settings.decorations
          ? "Show room decorations to visit your pets"
          : settings.show_pets === false
            ? "Show pets to visit your office cats"
            : black && button.disabled
              ? "Unlock the second cat after 100 sessions and 50 tools"
              : "Pet your office cat";
      }
    }
  }
  scene.onProp = interact;
  window.addEventListener("agent-office:task-runs", (event) => {
    scene.setTaskRunnerState(event.detail);
    sync();
  });
  scene.onPet = (key) => {
    const name =
      settings.pet_names?.[key === "blackcat" ? "cat2" : "cat1"] ||
      (key === "blackcat" ? "Gitcat" : "Claudio");
    toast(name + " purrs.");
  };
  scene.onHover = (text) => {
    if (!scene.edit && $("scene-hint").textContent !== (text || hint))
      $("scene-hint").textContent = text || hint;
  };
  $("room-lights").onclick = lights;
  $("arcade-open").onclick = () => window.officeArcade?.open();
  $("scene-hint").textContent = hint;
  window.officeRoom = { sync };
  sync();
})();
