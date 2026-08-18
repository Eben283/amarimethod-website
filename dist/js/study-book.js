(function () {
  "use strict";

  const API = "/api/study-book-v2";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  const STUDIES = {
    "tennis-elbow": {
      name: "Elbow Pain Study",
      bodyPrompt: "Which arm?",
      qualifications: [
        { id: "pain-duration", text: "I've had this pain for more than two weeks." },
        { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
      ],
    },
    tmj: {
      name: "Jaw Tension Study",
      bodyPrompt: "Which side?",
      qualifications: [
        { id: "pain-duration", text: "I've had this pain for more than two weeks." },
        { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
      ],
    },
    hand: {
      name: "Hand Pain Study",
      bodyPrompt: "Which hand?",
      qualifications: [
        { id: "pain-duration", text: "I've had this pain for more than two weeks." },
        { id: "activity-pattern", text: "It flares mid-session or with gripping, not a fresh sprain." },
        { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
      ],
    },
    "runners-lower-leg": {
      name: "Foot Pain Study",
      bodyPrompt: "Which foot?",
      qualifications: [
        { id: "pain-duration", text: "I've had this pain for more than two weeks." },
        { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
      ],
    },
    "desk-shoulders": {
      name: "Desk Shoulders Study",
      bodyPrompt: "Which shoulder?",
      qualifications: [
        { id: "pain-duration", text: "I've had this pain for more than two weeks." },
        { id: "activity-pattern", text: "It flares after a day at the screen, not a fresh injury." },
        { id: "three-visits", text: "I can come to our San Francisco office at 662 8th Ave for three visits." },
      ],
    },
  };

  const byId = (id) => document.getElementById(id);
  const elements = {
    banner: byId("bannerError"),
    initFallback: byId("bookingInitFallback"),
    heading: byId("pageHeading"),
    progress1: byId("progressStep1"),
    progress2: byId("progressStep2"),
    progress3: byId("progressStep3"),
    step1: byId("step1Section"),
    step2: byId("step2Section"),
    step3: byId("step3Section"),
    studyChooser: byId("studyChooser"),
    studySelect: byId("studySelect"),
    studyError: byId("studyError"),
    lockedStudy: byId("lockedStudy"),
    lockedStudyName: byId("lockedStudyName"),
    qualificationPanel: byId("qualificationPanel"),
    qualificationHeading: byId("qualificationHeading"),
    qualificationError: byId("qualificationError"),
    step2Heading: byId("step2Heading"),
    calendarBlock: byId("calendarBlock"),
    slotLoading: byId("slotLoading"),
    slotError: byId("slotError"),
    slotEmpty: byId("slotEmpty"),
    calFrame: byId("calFrame"),
    calLabel: byId("calLabel"),
    calDays: byId("calDays"),
    calPrev: byId("calPrevBtn"),
    calNext: byId("calNextBtn"),
    timesContainer: byId("timeSlotsContainer"),
    timesLabel: byId("timeSlotsLabel"),
    timeSlots: byId("timeSlots"),
    userTimezone: byId("userTimezone"),
    summary1: byId("orderSummaryStep1"),
    summaryStudies: document.querySelectorAll(".summary-study"),
    summaryDates: document.querySelectorAll(".summary-datetime"),
    continueButton: byId("step1ContinueBtn"),
    continueLabel: byId("step1ContinueLabel"),
    back: byId("backToStep1"),
    form: byId("clientForm"),
    bodyLegend: byId("bodyPartLegend"),
    qualifications: byId("qualificationItems"),
    submit: byId("step2SubmitBtn"),
    submitLabel: byId("step2SubmitLabel"),
    confirmationHeading: byId("confirmationHeading"),
    confirmationDate: byId("confirmationDate"),
    confirmationMessage: byId("confirmationMessage"),
  };

  const state = {
    studySlug: "",
    slotsByDay: {},
    availableDates: new Set(),
    selectedDate: null,
    selectedSlot: null,
    viewMonth: null,
    idempotencyKey: null,
    submitting: false,
    bookedPending: false,
    operationLocked: false,
    calendarUnlocked: false,
    submittedPayload: null,
  };

  const pad = (number) => String(number).padStart(2, "0");
  const ymd = (date) => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  const ym = (date) => date.getFullYear() + "-" + pad(date.getMonth() + 1);
  const dateFromYm = (value) => {
    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, 1);
  };
  const moveMonth = (value, delta) => {
    const date = dateFromYm(value);
    date.setMonth(date.getMonth() + delta);
    return ym(date);
  };
  const monthLabel = (value) => dateFromYm(value).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const longDate = (value) => {
    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };
  const displayTime = (hour, minute) => {
    const clockHour = hour % 12 || 12;
    return clockHour + (minute ? ":" + pad(minute) : "") + (hour >= 12 ? "pm" : "am");
  };

  function track(event, parameters) {
    if (window.gtag) {
      window.gtag("event", event, Object.assign({
        booking_type: "study_session",
        booking_price: 0,
        study: state.studySlug,
      }, parameters || {}));
    }
  }

  function showError(message) {
    elements.banner.textContent = message || "";
    elements.banner.classList.toggle("is-hidden", !message);
  }

  function setStep(number) {
    [elements.step1, elements.step2, elements.step3].forEach((element, index) => {
      const active = index === number - 1;
      element.classList.toggle("is-active", active);
      element.toggleAttribute("hidden", !active);
    });
    elements.progress1.classList.toggle("is-active", number === 1);
    elements.progress1.classList.toggle("is-done", number > 1);
    elements.progress2.classList.toggle("is-active", number === 2);
    elements.progress2.classList.toggle("is-done", number > 2);
    elements.progress3.classList.toggle("is-active", number === 3);
    [elements.progress1, elements.progress2, elements.progress3].forEach((element, index) => {
      if (index === number - 1) element.setAttribute("aria-current", "step");
      else element.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function newIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "study_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
  }

  function selectedStudy() {
    return STUDIES[state.studySlug] || null;
  }

  function renderStudyFields() {
    const study = selectedStudy();
    if (!study) return;

    elements.heading.textContent = "Book your first " + study.name + " session.";
    elements.lockedStudyName.textContent = study.name;
    elements.bodyLegend.textContent = study.bodyPrompt;
    elements.summaryStudies.forEach((element) => {
      element.textContent = study.name + " · In Person";
    });
    elements.qualifications.textContent = "";
    study.qualifications.forEach((qualification) => {
      const label = document.createElement("label");
      label.className = "screen-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "screen-check";
      checkbox.required = true;
      checkbox.dataset.qualification = qualification.id;
      const text = document.createElement("span");
      text.textContent = qualification.text;
      label.append(checkbox, text);
      elements.qualifications.append(label);
    });
    elements.qualificationPanel.hidden = false;
    elements.continueButton.disabled = false;
    elements.continueLabel.textContent = "Confirm eligibility to see times";
  }

  function qualificationsComplete() {
    const study = selectedStudy();
    const checkboxes = Array.from(
      elements.qualifications.querySelectorAll("[data-qualification]"),
    );
    return Boolean(study) &&
      checkboxes.length === study.qualifications.length &&
      checkboxes.every((checkbox) => checkbox.checked);
  }

  function updateQualificationGate() {
    if (!selectedStudy()) {
      elements.continueButton.disabled = true;
      return;
    }
    const complete = qualificationsComplete();
    elements.continueLabel.textContent = complete
      ? "See available times"
      : "Confirm eligibility to see times";
    if (complete) elements.qualificationError.textContent = "";
  }

  function resetCalendarState() {
    state.calendarUnlocked = false;
    state.slotsByDay = {};
    state.availableDates = new Set();
    state.selectedDate = null;
    state.selectedSlot = null;
    state.idempotencyKey = null;
    state.submittedPayload = null;
    elements.calendarBlock.hidden = true;
    elements.timesContainer.hidden = true;
    elements.timeSlots.textContent = "";
    elements.calDays.textContent = "";
    elements.calFrame.hidden = true;
    elements.slotLoading.hidden = false;
    elements.slotError.hidden = true;
    elements.slotEmpty.hidden = true;
    elements.summary1.hidden = true;
    elements.summaryDates.forEach((element) => {
      element.textContent = "—";
    });
    elements.submit.disabled = true;
    elements.submitLabel.textContent = "Choose a time to book";
  }

  function focusQualification() {
    window.requestAnimationFrame(() => elements.qualificationHeading.focus());
  }

  function showStudyChooser(message) {
    state.studySlug = "";
    elements.studySelect.value = "";
    elements.studySelect.disabled = false;
    elements.studyChooser.hidden = false;
    elements.lockedStudy.hidden = true;
    elements.qualificationPanel.hidden = true;
    elements.studyError.textContent = message || "";
    resetCalendarState();
    if (message) window.requestAnimationFrame(() => elements.studySelect.focus());
  }

  function activateStudy(slug, options = {}) {
    if (!STUDIES[slug]) return false;
    state.studySlug = slug;
    state.bookedPending = false;
    state.operationLocked = false;
    elements.studySelect.value = slug;
    elements.studySelect.disabled = true;
    elements.studyChooser.hidden = true;
    elements.lockedStudy.hidden = false;
    elements.studyError.textContent = "";
    elements.back.hidden = false;
    resetCalendarState();
    renderStudyFields();
    updateQualificationGate();
    const url = new URL(window.location.href);
    url.searchParams.set("study", slug);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (options.focus) focusQualification();
    track("study_selected");
    return true;
  }

  async function loadMonth() {
    showError("");
    state.selectedDate = null;
    state.selectedSlot = null;
    state.idempotencyKey = null;
    state.submittedPayload = null;
    elements.submit.disabled = true;
    elements.submitLabel.textContent = "Choose a time to book";
    elements.summary1.hidden = true;
    elements.timesContainer.hidden = true;
    elements.slotLoading.hidden = false;
    elements.slotError.hidden = true;
    elements.slotEmpty.hidden = true;
    elements.calFrame.hidden = true;
    elements.calLabel.textContent = monthLabel(state.viewMonth);
    elements.calPrev.disabled = state.viewMonth <= ym(new Date());
    elements.userTimezone.textContent = timezone;

    const start = dateFromYm(state.viewMonth);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const query = "?study=" + encodeURIComponent(state.studySlug) +
      "&startDate=" + ymd(start) + "&endDate=" + ymd(end) +
      "&timezone=" + encodeURIComponent(timezone);

    try {
      const response = await fetch(API + query);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load available times.");
      const byDay = {};
      (body.slots || []).forEach((slot) => {
        if (!byDay[slot.date]) byDay[slot.date] = [];
        byDay[slot.date].push(slot);
      });
      state.slotsByDay = byDay;
      state.availableDates = new Set(Object.keys(byDay));
      elements.slotLoading.hidden = true;
      elements.calFrame.hidden = false;
      elements.slotEmpty.hidden = state.availableDates.size > 0;
      renderCalendar();
    } catch (error) {
      elements.slotLoading.hidden = true;
      elements.slotError.hidden = false;
      elements.slotError.textContent = "Could not load times. Refresh the page or email eben@amarimethod.com.";
      showError(error.message || "Could not load available times.");
    }
  }

  function renderCalendar() {
    elements.calLabel.textContent = monthLabel(state.viewMonth);
    elements.calDays.textContent = "";
    const first = dateFromYm(state.viewMonth);
    const startDay = first.getDay();
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = ymd(new Date());

    for (let index = 0; index < startDay; index += 1) {
      const empty = document.createElement("span");
      empty.className = "cal-day is-empty";
      elements.calDays.append(empty);
    }

    for (let day = 1; day <= days; day += 1) {
      const date = state.viewMonth + "-" + pad(day);
      const button = document.createElement("button");
      const available = state.availableDates.has(date);
      button.type = "button";
      button.className = "cal-day";
      button.textContent = day;
      button.setAttribute("aria-label", longDate(date));
      if (date < today || !available) {
        button.classList.add("is-unavailable");
        button.disabled = true;
      } else {
        button.addEventListener("click", () => selectDate(date));
      }
      if (date === today) button.classList.add("is-today");
      if (date === state.selectedDate) button.classList.add("is-selected");
      elements.calDays.append(button);
    }
  }

  function selectDate(date) {
    state.selectedDate = date;
    state.selectedSlot = null;
    state.idempotencyKey = null;
    state.submittedPayload = null;
    renderCalendar();
    elements.timesContainer.hidden = false;
    elements.timesLabel.textContent = longDate(date);
    elements.timeSlots.textContent = "";
    (state.slotsByDay[date] || []).forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot-btn";
      button.textContent = displayTime(slot.hour, slot.minute);
      button.addEventListener("click", () => selectSlot(slot, button));
      elements.timeSlots.append(button);
    });
    elements.summary1.hidden = true;
    elements.submit.disabled = true;
    elements.submitLabel.textContent = "Choose a time to book";
  }

  function selectSlot(slot, button) {
    const changed = state.selectedSlot?.datetime !== slot.datetime;
    state.selectedSlot = slot;
    if (changed || !state.idempotencyKey) state.idempotencyKey = newIdempotencyKey();
    Array.from(elements.timeSlots.children).forEach((element) => {
      element.classList.toggle("is-selected", element === button);
    });
    const label = longDate(slot.date) + " at " + displayTime(slot.hour, slot.minute);
    elements.summaryDates.forEach((element) => {
      element.textContent = label;
    });
    elements.summary1.hidden = false;
    elements.submit.disabled = false;
    elements.submitLabel.textContent = "Confirm free study session";
    track("study_slot_selected", { slot_datetime: slot.datetime });
  }

  function setFieldError(name, message) {
    const input = elements.form.elements[name];
    const error = document.querySelector('[data-error-for="' + name + '"]');
    if (input) input.classList.toggle("is-invalid", Boolean(message));
    if (error) error.textContent = message || "";
  }

  function readForm() {
    const fields = elements.form.elements;
    const qualifications = {};
    elements.qualifications.querySelectorAll("[data-qualification]").forEach((checkbox) => {
      qualifications[checkbox.dataset.qualification] = checkbox.checked;
    });
    const body = elements.form.querySelector('input[name="bodyPart"]:checked');
    return {
      firstName: fields.firstName.value.trim(),
      lastName: fields.lastName.value.trim(),
      email: fields.email.value.trim(),
      phone: fields.phone.value.trim(),
      bodyPart: body ? body.value : "",
      qualifications,
      publishOptIn: byId("publishOptIn").checked,
    };
  }

  function validateForm(data) {
    let valid = true;
    ["firstName", "lastName", "email", "phone"].forEach((name) => setFieldError(name, ""));
    if (!data.firstName) { setFieldError("firstName", "Required"); valid = false; }
    if (!data.lastName) { setFieldError("lastName", "Required"); valid = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { setFieldError("email", "Enter a valid email"); valid = false; }
    if (data.phone.replace(/\D/g, "").length < 10) { setFieldError("phone", "Enter at least 10 digits"); valid = false; }
    if (!selectedStudy().qualifications.every((item) => data.qualifications[item.id] === true)) {
      showError("Confirm every study qualification.");
      valid = false;
    }
    return valid;
  }

  function lockEffectingFields() {
    elements.studySelect.disabled = true;
    elements.continueButton.disabled = true;
    elements.qualifications.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
    elements.calendarBlock.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    elements.form.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });
  }

  function lockForSameKey(message, label, booked) {
    state.operationLocked = true;
    state.bookedPending = Boolean(booked);
    lockEffectingFields();
    elements.back.hidden = true;
    elements.submit.disabled = false;
    elements.submitLabel.textContent = label || "Check the same reservation";
    showError(message);
  }

  function lockForReview(message) {
    state.operationLocked = true;
    lockEffectingFields();
    elements.back.hidden = true;
    elements.submit.disabled = true;
    elements.submitLabel.textContent = "Staff review required";
    showError(message);
  }

  elements.studySelect.addEventListener("change", () => {
    const slug = elements.studySelect.value;
    if (!slug) {
      elements.studyError.textContent = "Choose one of the five current studies.";
      return;
    }
    activateStudy(slug, { focus: true });
  });

  elements.qualifications.addEventListener("change", () => {
    const complete = qualificationsComplete();
    if (state.calendarUnlocked && !complete) resetCalendarState();
    updateQualificationGate();
  });

  elements.calPrev.addEventListener("click", () => {
    if (!elements.calPrev.disabled) {
      state.viewMonth = moveMonth(state.viewMonth, -1);
      loadMonth();
    }
  });
  elements.calNext.addEventListener("click", () => {
    state.viewMonth = moveMonth(state.viewMonth, 1);
    loadMonth();
  });
  elements.continueButton.addEventListener("click", () => {
    if (!selectedStudy()) return;
    if (!qualificationsComplete()) {
      elements.qualificationError.textContent = "Confirm every study qualification before viewing times.";
      const firstUnchecked = elements.qualifications.querySelector(
        "[data-qualification]:not(:checked)",
      );
      if (firstUnchecked) firstUnchecked.focus();
      return;
    }
    showError("");
    elements.qualificationError.textContent = "";
    const alreadyUnlocked = state.calendarUnlocked;
    state.calendarUnlocked = true;
    elements.calendarBlock.hidden = false;
    setStep(2);
    elements.step2Heading.focus();
    if (!alreadyUnlocked) loadMonth();
    track("study_eligibility_confirmed");
  });

  elements.back.addEventListener("click", () => {
    if (!state.operationLocked) {
      setStep(1);
      focusQualification();
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.submitting || !state.selectedSlot || !selectedStudy()) return;
    showError("");
    if (!state.submittedPayload) {
      const data = readForm();
      if (!validateForm(data)) return;
      state.submittedPayload = {
        study: state.studySlug,
        name: data.firstName + " " + data.lastName,
        phone: data.phone,
        email: data.email,
        bodyPart: data.bodyPart || undefined,
        qualifications: data.qualifications,
        publishOptIn: data.publishOptIn,
        startTime: state.selectedSlot.datetime,
        timezone,
        idempotencyKey: state.idempotencyKey,
      };
    }

    state.submitting = true;
    elements.submit.disabled = true;
    elements.submitLabel.textContent = state.bookedPending
      ? "Finishing enrollment…"
      : state.operationLocked ? "Checking reservation…" : "Booking…";

    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.submittedPayload),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body.booked) {
          lockForSameKey(
            body.error || "Your time is reserved. Submit again to finish enrollment; this will not create another appointment.",
            "Finish enrollment",
            true,
          );
          track("study_enrollment_pending");
          return;
        }
        if (body.retrySameKey && !body.manualReview) {
          lockForSameKey(
            body.error || "This reservation must be checked with the same booking. Do not choose another time.",
            "Check the same reservation",
            false,
          );
          track("study_booking_reconciliation_pending");
          return;
        }
        if (body.manualReview || body.appointmentUncertain || body.doNotRebook) {
          lockForReview(body.error || "This reservation needs staff review. Do not book another time.");
          track("study_booking_manual_review");
          return;
        }
        if (state.operationLocked) {
          lockForSameKey(
            body.error || "Submit the same booking again. Do not choose another time.",
            "Try the same reservation again",
            state.bookedPending,
          );
          return;
        }
        elements.submit.disabled = false;
        elements.submitLabel.textContent = body.retrySameKey ? "Try the same booking again" : "Confirm free study session";
        showError(body.error || "Could not save that booking. Please try again.");
        return;
      }

      const label = longDate(state.selectedSlot.date) + " at " +
        displayTime(state.selectedSlot.hour, state.selectedSlot.minute) + ".";
      elements.confirmationHeading.textContent = "You’re booked.";
      elements.confirmationDate.textContent = label;
      elements.confirmationMessage.textContent = "Your first " + selectedStudy().name + " session is reserved.";
      setStep(3);
      track("study_booking_confirmed", { slot_datetime: state.selectedSlot.datetime });
    } catch (error) {
      lockForSameKey(
        "The booking response was interrupted. Submit the same booking again. Do not choose another time.",
        state.bookedPending ? "Finish enrollment" : "Check the same reservation",
        state.bookedPending,
      );
      track("study_booking_transport_pending");
    } finally {
      state.submitting = false;
    }
  });

  state.viewMonth = ym(new Date());
  elements.userTimezone.textContent = timezone;
  elements.initFallback.hidden = true;
  const requestedSlug = new URL(window.location.href).searchParams.get("study") || "";
  if (STUDIES[requestedSlug]) {
    activateStudy(requestedSlug);
  } else {
    showStudyChooser(requestedSlug
      ? "That study is not currently open. Choose one of the five current studies."
      : "");
  }
})();
