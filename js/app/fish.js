class Fish {
  constructor(fishData) {
    _(this).extend(fishData);
    this.id = fishData._id;
    this.name = DATA.ITEMS[this.id].name;
    this.icon = DATA.ITEMS[this.id].icon;
    if (fishData.location !== null) {
      var fishingSpot = DATA.FISHING_SPOTS[fishData.location];
      this.location = {
        name: fishingSpot.name,
        zoneName: DATA.WEATHER_RATES[fishingSpot.territory_id].zone_name,
        id: fishingSpot._id,
        zoneId: fishingSpot.territory_id,
      };
    } else {
      this.location = {name: '', zoneName: '', id: 0, zoneId: 0};
    }
    this.catchableRanges = [];
    {
      var diff = Math.abs(this.endHour - this.startHour);
      this.dailyDuration =
        moment.duration(this.endHour < this.startHour ? 24 - diff : diff, 'hours');
    }
    this.conditions = {
      previousWeatherSet: _(this.previousWeatherSet).map((w) => DATA.WEATHER_TYPES[w]),
      weatherSet: _(this.weatherSet).map((w) => DATA.WEATHER_TYPES[w])
    };
    this.bait = {
      hasPredators: _(this.predators).size() > 0,
      predators: _(this.predators).map((v, k) => {
        return { count: v,
                 name: DATA.ITEMS[k].name,
                 icon: DATA.ITEMS[k].icon };
      }),
      path: _(this.bestCatchPath).map((x) => DATA.ITEMS[x])
    };
    this.alwaysAvailable =
      this.weatherSet.length == 0 && this.startHour == 0 && this.endHour == 24;

    // Create a subject for catchableRanges that we can subscribe to.
    //this.catchableRangesObserver = new Rx.Observable.ofArrayChanges(this.catchableRanges);
    this.catchableRangesObserver = new Rx.BehaviorSubject([]);
  }

  notifyCatchableRangesUpdated() {
    this.catchableRangesObserver.onNext(this.catchableRanges);
  }

  isCatchable() {
    var crs = this.catchableRanges;
    if (crs.length > 0) {
      return dateFns.isSameOrAfter(Date.now(), eorzeaTime.toEarth(+crs[0].start()));
    }
    return false;
  }

  uptime() {
    var crs = this.catchableRanges;
    if (crs.length > 0) {
      // Compute the overall time this fish is up for.
      var overallTime = +_(crs).last().end() - +_(crs).first().start();
      return _(crs).reduce(
        (uptime, range) => uptime += range.asDuration('milliseconds'), 0) / overallTime;
    }
    return 1;
  }

  availableRangeDuring(r) {
    // If the fish is always available, just return the given range.
    if (this.startHour == 0 && this.endHour == 24) {
      return r;
    }
    // How long is the fish normally available?
    var d = this.dailyDuration;
    var m = +r.start();
    if (this.endHour < this.startHour) {
      // Available times wraps around date...
      if (dateFns.utc.getHours(m) < this.endHour) {
        // Return the *remaining* portion of the catchable range which started
        // yesterday.
        return d.afterMoment(
          moment.utc(dateFns.utc.setHours(dateFns.utc.subDays(m, 1), this.startHour)));
      } else {
        // Otherwise, return the window for today.
        return d.afterMoment(
          moment.utc(dateFns.utc.setHours(m, this.startHour)));
      }
    } else {
      // Available times limited to this date.
      if (dateFns.utc.getHours(m) < this.endHour) {
        // The fish's *current* range begins (or began) today.
        return d.afterMoment(
          moment.utc(dateFns.utc.setHours(m, this.startHour)));
      } else {
        // Return tomorrow's range since we're already past today's window.
        return d.afterMoment(
          moment.utc(dateFns.utc.setHours(dateFns.utc.addDays(m, 1), this.startHour)));
      }
    }
  }

  addCatchableRange(nextRange) {
    // Add or merge next range with existing catchable ranges.
    if (_(this.catchableRanges).isEmpty()) {
      // The first entry is special. We can simply push it into the array.
      // Remember, it's observable!
      this.catchableRanges.push(nextRange);
      this.notifyCatchableRangesUpdated();
      return;
    }

    var lastRange = _(this.catchableRanges).last();
    // WARNING:
    //   You should never call this function giving the same range as the last
    //   one. Also, the next range BETTER be AFTER the last one!!!
    if (nextRange.start().isBefore(lastRange.end())) {
      console.error("CRITICAL BUG: The next range starts before the end of the last range!");
      return;
    }
    var merged = lastRange.xor(nextRange);
    // SAFEGUARD:
    //   If everything's being done right, xor should NEVER return a list
    //   of nothing! But, mistakes happen, and to avoid deleting data by
    //   mistake in addition, we'll just abort right here... and complain...
    if (merged === null || merged.length == 0) {
      console.error("CRITICAL BUG: merged is empty?!",
        {lastRange: lastRange.simpleFormat(),
         nextRange: nextRange.simpleFormat()});
      return;
    }
    this.catchableRanges.splice.apply(
      this.catchableRanges, [-1, 1].concat(merged) );
    this.notifyCatchableRangesUpdated();
  }
}

let Fishes = _(DATA.FISH).chain()
  .values()
  .map((fishData) => new Fish(fishData))
  .value();
