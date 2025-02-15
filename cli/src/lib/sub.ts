import * as mqtt from 'mqtt'
import { Signale, signale, msgLog, basicLog, benchLog } from '../utils/signale'
import { parseConnectOptions, parseSubscribeOptions } from '../utils/parse'
import delay from '../utils/delay'
import convertPayload from '../utils/convertPayload'

const sub = (options: SubscribeOptions) => {
  const connOpts = parseConnectOptions(options, 'sub')

  const client = mqtt.connect(connOpts)

  const { maximunReconnectTimes } = options

  let retryTimes = 0

  basicLog.connecting()

  client.on('connect', () => {
    basicLog.connected()

    retryTimes = 0

    const subOptsArray = parseSubscribeOptions(options)

    const { topic } = options

    topic.forEach((t: string, index: number) => {
      const subOpts = subOptsArray[index]

      basicLog.subscribing(t)

      client.subscribe(t, subOpts, (err, result) => {
        if (err) {
          basicLog.error(err)
          process.exit(1)
        } else {
          basicLog.subscribed(t)
        }

        result.forEach((sub) => {
          if (sub.qos > 2) {
            basicLog.subscriptionNegated(sub)
            process.exit(1)
          }
        })
      })
    })
  })

  client.on('message', (topic, payload, packet) => {
    const { format } = options

    const msgData: Record<string, unknown>[] = []

    options.verbose && msgData.push({ label: 'topic', value: topic })

    msgData.push({ label: 'payload', value: convertPayload(payload, format) })

    packet.retain && msgData.push({ label: 'retain', value: packet.retain })

    packet.properties?.userProperties &&
      msgData.push({ label: 'user properties', value: { ...packet.properties.userProperties } })

    msgLog(msgData)
  })

  client.on('error', (err) => {
    basicLog.error(err)
    client.end()
  })

  client.on('reconnect', () => {
    retryTimes += 1
    if (retryTimes > maximunReconnectTimes) {
      client.end(false, {}, () => {
        basicLog.reconnectTimesLimit()
      })
    } else {
      basicLog.reconnecting()
    }
  })

  client.on('close', () => {
    basicLog.close()
  })
}

const benchSub = async (options: BenchSubscribeOptions) => {
  const { count, interval, topic, clientId, verbose, maximunReconnectTimes } = options

  const connOpts = parseConnectOptions(options, 'sub')

  let connectedCount = 0

  const subOptsArray = parseSubscribeOptions(options)

  const isNewConnArray = Array(count).fill(true)

  const retryTimesArray = Array(count).fill(0)

  const interactive = new Signale({ interactive: true })
  const simpleInteractive = new Signale({ interactive: true, config: { displayLabel: false, displayTimestamp: true } })

  signale.info(
    `Start the subscribe benchmarking, connections: ${count}, req interval: ${interval}ms, topic: ${topic.join(',')}`,
  )

  const connStart = Date.now()

  let total = 0
  let oldTotal = 0

  for (let i = 1; i <= count; i++) {
    ;((i: number, connOpts: mqtt.IClientOptions) => {
      const opts = { ...connOpts }

      opts.clientId = clientId.includes('%i') ? clientId.replaceAll('%i', i.toString()) : `${clientId}_${i}`

      const client = mqtt.connect(opts)

      interactive.await('[%d/%d] - Connecting...', connectedCount, count)

      client.on('connect', () => {
        connectedCount += 1
        retryTimesArray[i - 1] = 0
        if (isNewConnArray[i - 1]) {
          interactive.success('[%d/%d] - Connected', connectedCount, count)

          topic.forEach((t: string, index: number) => {
            const { username, clientId } = opts

            let topicName = t.replaceAll('%i', i.toString()).replaceAll('%c', clientId!)
            username && (topicName = topicName.replaceAll('%u', username))

            const subOpts = subOptsArray[index]

            interactive.await('[%d/%d] - Subscribing to %s...', connectedCount, count, topicName)

            client.subscribe(topicName, subOpts, (err, result) => {
              if (err) {
                signale.error(`[${i}/${count}] - Client ID: ${opts.clientId}, ${err}`)
                process.exit(1)
              } else {
                interactive.success('[%d/%d] - Subscribed to %s', connectedCount, count, topicName)
              }

              result.forEach((sub) => {
                if (sub.qos > 2) {
                  signale.error(
                    `[${i}/${count}] - Client ID: ${opts.clientId}, subscription negated to ${sub.topic} with code ${sub.qos}`,
                  )
                  process.exit(1)
                }
              })

              if (i === count) {
                const connEnd = Date.now()

                signale.info(`Created ${count} connections in ${(connEnd - connStart) / 1000}s`)

                total = 0

                if (!verbose) {
                  setInterval(() => {
                    if (total > oldTotal) {
                      const rate = total - oldTotal
                      simpleInteractive.info(`Received total: ${total}, rate: ${rate}/s`)
                    }
                    oldTotal = total
                  }, 1000)
                } else {
                  setInterval(() => {
                    if (total > oldTotal) {
                      const rate = total - oldTotal
                      signale.info(`Received total: ${total}, rate: ${rate}/s`)
                    }
                    oldTotal = total
                  }, 1000)
                }
              }
            })
          })
        } else {
          benchLog.reconnected(connectedCount, count, opts.clientId!)
        }
      })

      client.on('message', () => {
        total += 1
      })

      client.on('error', (err) => {
        benchLog.error(connectedCount, count, opts.clientId!, err)
        client.end()
      })

      client.on('reconnect', () => {
        retryTimesArray[i - 1] += 1
        if (retryTimesArray[i - 1] > maximunReconnectTimes) {
          client.end(false, {}, () => {
            benchLog.reconnectTimesLimit(connectedCount, count, opts.clientId!)
            if (retryTimesArray.findIndex((times) => times <= maximunReconnectTimes) === -1) {
              process.exit(1)
            }
          })
        } else {
          benchLog.reconnecting(connectedCount, count, opts.clientId!)
          isNewConnArray[i - 1] = false
        }
      })

      client.on('close', () => {
        connectedCount > 0 && (connectedCount -= 1)
        benchLog.close(connectedCount, count, opts.clientId!)
      })
    })(i, connOpts)

    await delay(interval)
  }
}

export default sub

export { sub, benchSub }
