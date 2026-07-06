function getDayNumber(dayName) {
  const days = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  };

  return days[dayName];
}

function addDays(dateString, daysToAdd) {
  const date = new Date(dateString + "T00:00:00");
  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().split("T")[0];
}

function getDayName(dateString) {
  const date = new Date(dateString + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function isCheckInCoveredByStandardDay(checkInDate, standardDay) {
  const checkInDayNumber = getDayNumber(getDayName(checkInDate));
  const standardDayNumber = getDayNumber(standardDay);

  const nextDayNumber = (standardDayNumber + 1) % 7;

  return checkInDayNumber === standardDayNumber || checkInDayNumber === nextDayNumber;
}

function getSuggestedGuestReadyDate(checkInDate) {
  return checkInDate;
}

function buildGuestReadyTask(property, reservation) {
  const suggestedDate = getSuggestedGuestReadyDate(reservation.check_in);

  return {
    property_id: property.id,
    service_date: suggestedDate,
    scheduled_date: suggestedDate,
    suggested_date: suggestedDate,
    check_in_date: reservation.check_in,
    service_type: "Guest Ready",
    status: "Scheduled",
    off_cycle: true,
    guest_ready: true,
    charge: Number(property.default_off_cycle_charge || 65),
    notes: "Auto-created from reservation check-in."
  };
}