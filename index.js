const protobuf = require("protobufjs");
const fetch = require("node-fetch");
const parse = require('csv-parse');
const moment = require('moment-timezone');
const unique = require('array-unique');
const subwayLineToFeedIdMap = require('./subwayLineToFeedIdMap');
const GTFSStopIdToStationNameMap = require('./GTFSStopIdToStationNameMap');

const transit = protobuf.loadProtoFile('nyct-subway.proto');
const builder = transit.build('transit_realtime');

// Construct an apiUrl for the provided subway line.
const buildFeedUrl = ({apiKey, line}) => {
  const feedId = subwayLineToFeedIdMap[line];
  return `http://datamine.mta.info/mta_esi.php?key=${apiKey}&feed_id=${feedId}`;
}

// Fetch the API feeds for the provided subway lines.
// Returns a Promise that resolves with the JSON data for all requests.
const fetchLineFeeds = ({apiKey, lines}) => {
  const feedUrls = unique(
    lines.map(
      line => buildFeedUrl({apiKey, line})
    )
  );
  return Promise.all(
    feedUrls.map( feedUrl => {
      return fetch(feedUrl)
        .then(response => response.arrayBuffer())
        .then(buffer => builder.FeedMessage.decode(buffer))
    })
  );
};

const extractStopTimeUpdatesFromFeed = feed => {
  return feed.entity.map(message => {
    if (message.trip_update) {
      return message.trip_update.stop_time_update.map(async stopTimeUpdate => {
        const stopIdLong = stopTimeUpdate.stop_id;
        const direction = stopIdLong.substring(stopIdLong.length - 1);
        const stopId = stopIdLong.substring(0, stopIdLong.length - 1);
        const stopName = GTFSStopIdToStationNameMap[stopId];
        const { route_id } = message.trip_update.trip;
        return Object.assign(stopTimeUpdate, { route_id, stopName, direction });
      });
    } else {
      debugger;
    }
    return null;
  }).filter(value => value !== null);
}

const extractRelevantArrivalsFromFeedMessages = ({feedMessages, lines, stations}) => {
  const matches = [];
  feedMessages.forEach(feedMessage => {
    // Skip feedMessages that don't include a trip update.
    if (!feedMessage.trip_update) {
      return false;
    }
    const line = feedMessage.trip_update.trip.route_id;
    if (!lines.includes(line)) {
      return false;
    }
    feedMessage.trip_update.stop_time_update.forEach(stopTimeUpdate => {
      const stopIdAndDirection = stopTimeUpdate.stop_id;
      const stopId = stopIdAndDirection.substring(0, stopIdAndDirection.length - 1);
      const direction = stopIdAndDirection.substring(stopIdAndDirection.length - 1);
      const stopName = GTFSStopIdToStationNameMap[stopId];
      if (!stations.includes(stopName)) {
        return;
      }
      const arrival = {
        line,
        direction,
        stopName,
        GTFSStopId: stopId,
        time: stopTimeUpdate.arrival.time.low
      };
      matches.push(arrival);
    });
  });
  return matches;
}

const mtaLib = (apiKey) => {
  return {
    arrivals({lines, stations}) {
      if (typeof lines === 'string') {
        lines = [lines];
      }
      if (typeof stations === 'string') {
        stations = [stations];
      }
      return fetchLineFeeds({apiKey, lines})
        .then(feeds => {
          let arrivals = [];
          feeds.forEach(feed => {
            arrivals = arrivals.concat(
              extractRelevantArrivalsFromFeedMessages({
                feedMessages: feed.entity,
                lines,
                stations
              })
            );
          });
          return arrivals;
        })
    }
  };
};

const mta = mtaLib('9c53a03b8da895b96df75e8fb6e9ffd5');

mta.arrivals({lines: ['F', 'A'], stations: ['2 Av', 'W 4 St']})
  .then(arrivals => {
    console.log(arrivals);
  });