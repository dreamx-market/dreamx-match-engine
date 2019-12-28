const Web3Utils = require('web3-utils')

const oneEther = Web3Utils.toBN(Web3Utils.toWei('1'))
const zero = Web3Utils.toBN('0')

const match = ({ order, orderBook, makerMinimum, takerMinimum }) => {
  const { buyBook, sellBook } = orderBook
  let result
  if (order.type === 'buy') {
    result = matchSellOrders({ order, sellBook, makerMinimum, takerMinimum })
  } else {
    result = matchBuyOrders({ order, buyBook, makerMinimum, takerMinimum })
  }
  return result
}

// order = { giveTokenAddress, giveAmount, takeTokenAddress, takeAmount, type }
const matchBuyOrders = ({ order, buyBook, makerMinimum, takerMinimum }) => {
  makerMinimum = Web3Utils.toBN(makerMinimum)
  takerMinimum = Web3Utils.toBN(takerMinimum)
  const result = { orders: [], trades: [] }
  const price = Web3Utils.toBN(getOrderVolume(order).price)
  const giveAmount = Web3Utils.toBN(order.giveAmount)
  const takeAmount = Web3Utils.toBN(order.takeAmount)
  let filledGiveAmount = Web3Utils.toBN(0)
  let remainingGiveAmount = Web3Utils.toBN(order.giveAmount)
  let remainingTakeAmount = Web3Utils.toBN(order.takeAmount)
  // find matched orders
  const matched = buyBook.filter(o => {
    const orderPrice = Web3Utils.toBN(getOrderVolume(o).price)
    return orderPrice.gte(price)
  }).sort((a, b) => {
  // sort matched orders by descending price and date
    const aPrice = Web3Utils.toBN(getOrderVolume(a).price)
    const bPrice = Web3Utils.toBN(getOrderVolume(b).price)
    const aCreatedAt = new Date(a.createdAt).getTime()
    const bCreatedAt = new Date(b.createdAt).getTime()
    if (aPrice.lt(bPrice)) {
      // a.price < b.price, b comes first
      return 1
    } else if (aPrice.gt(bPrice)) {
      // a.price > b.price, a comes first
      return -1
    } else if (aCreatedAt > bCreatedAt) {
      // a is more recently created, b comes first
      return 1
    } else if (aCreatedAt < bCreatedAt) {
      // a is older than b, a comes first
      return -1
    } else {
      // a and b are equal in price and date, keep their existing order
      return 0
    }
  })
  if (matched.length < 1) {
    result.orders.push({ type: order.type, giveAmount: order.giveAmount, giveTokenAddress: order.giveTokenAddress, takeAmount: order.takeAmount, takeTokenAddress: order.takeTokenAddress })
    return result
  }
  // fill matched orders
  for (let matchedOrder of matched) {
    if (filledGiveAmount.eq(giveAmount)) {
      break
    }
    const matchedOrderFilled = Web3Utils.toBN(matchedOrder.filled)
    const matchedOrderGiveAmount = Web3Utils.toBN(matchedOrder.giveAmount)
    const matchedOrderTakeAmount = Web3Utils.toBN(matchedOrder.takeAmount)
    const matchedOrderRemainingGiveAmount = matchedOrderGiveAmount.sub(matchedOrderFilled)
    // remaining amount of take tokens should be calculated by the matched order's give/take rate
    // because it is relative to the matched order's price
    remainingTakeAmount = calculateTakeAmount(remainingGiveAmount, matchedOrderTakeAmount, matchedOrderGiveAmount)
    let trade, tradeAmount
    if (remainingTakeAmount.gt(matchedOrderRemainingGiveAmount)) {
      tradeAmount = matchedOrderRemainingGiveAmount
    } else {
      tradeAmount = remainingTakeAmount
    }
    if (tradeAmount.lt(takerMinimum)) {
      continue
    }
    // the amount of give tokens equivalent to the trade amount should be calculated by the matched order's give/take rate
    // because it is relative to the matched order's price
    const tradeAmountEquivalentInGiveToken = calculateGiveAmount(tradeAmount, matchedOrderTakeAmount, matchedOrderGiveAmount)
    // amountGive is used for refunding the matching order after trade cancelling, it will be removed before it is returned
    trade = { orderHash: matchedOrder.orderHash, amount: tradeAmount, amountGive: tradeAmountEquivalentInGiveToken }
    filledGiveAmount = filledGiveAmount.add(tradeAmountEquivalentInGiveToken)
    remainingGiveAmount = remainingGiveAmount.sub(tradeAmountEquivalentInGiveToken)
    remainingTakeAmount = remainingTakeAmount.sub(tradeAmount)
    result.trades.push(trade)
  }
  // create a rest order if there is still remaining volume
  const hasRemainingGiveAmount = filledGiveAmount.lt(giveAmount)
  const onePercentOfTotalGive = giveAmount.div(Web3Utils.toBN('100'))
  const remainingGiveAmountIsAboveOnePercent = remainingGiveAmount.gte(onePercentOfTotalGive)
  if (hasRemainingGiveAmount && remainingGiveAmountIsAboveOnePercent) {
    // re-calculate remainingTakeAmount before assigning to the rest order 
    // because it might no longer reflect the specified selling price
    // due to the matching & filling of buy orders of higher prices
    let restOrderGiveAmount = remainingGiveAmount
    let restOrderTakeAmount = calculateTakeAmount(remainingGiveAmount, giveAmount, takeAmount)
    // remaining volume is below maker's minimum, cancel trades until it is back above
    while (restOrderTakeAmount.lt(makerMinimum)) {
      const lastTrade = result.trades.pop()
      const tradeAmount = lastTrade.amount
      const tradeAmountEquivalentInGiveToken = lastTrade.amountGive
      filledGiveAmount = filledGiveAmount.sub(tradeAmountEquivalentInGiveToken)
      remainingGiveAmount = remainingGiveAmount.add(tradeAmountEquivalentInGiveToken)
      remainingTakeAmount = remainingTakeAmount.add(tradeAmount)
      restOrderTakeAmount = calculateTakeAmount(remainingGiveAmount, giveAmount, takeAmount)
      restOrderGiveAmount = remainingGiveAmount
    }
    const restOrder = { type: order.type, giveAmount: restOrderGiveAmount.toString(), giveTokenAddress: order.giveTokenAddress, takeAmount: restOrderTakeAmount.toString(), takeTokenAddress: order.takeTokenAddress }
    result.orders.push(restOrder)
  }
  // remove amountGive and convert amount to string before returning
  for (let trade of result.trades) {
    delete trade.amountGive
    trade.amount = trade.amount.toString()
  }
  return result
}

const matchSellOrders = ({ order, sellBook, makerMinimum, takerMinimum }) => {
  makerMinimum = Web3Utils.toBN(makerMinimum)
  takerMinimum = Web3Utils.toBN(takerMinimum)
  const result = { orders: [], trades: [] }
  const price = Web3Utils.toBN(getOrderVolume(order).price)
  const giveAmount = Web3Utils.toBN(order.giveAmount)
  const takeAmount = Web3Utils.toBN(order.takeAmount)
  let filledTakeAmount = Web3Utils.toBN(0)
  let remainingTakeAmount = Web3Utils.toBN(order.takeAmount)
  let remainingGiveAmount = Web3Utils.toBN(order.giveAmount)
  // find matched orders
  const matched = sellBook.filter(o => {
    const orderPrice = Web3Utils.toBN(getOrderVolume(o).price)
    return orderPrice.lte(price)
  }).sort((a, b) => {
  // sort matched orders by ascending price and date
    const aPrice = Web3Utils.toBN(getOrderVolume(a).price)
    const bPrice = Web3Utils.toBN(getOrderVolume(b).price)
    const aCreatedAt = new Date(a.createdAt).getTime()
    const bCreatedAt = new Date(b.createdAt).getTime()
    if (aPrice.lt(bPrice)) {
      // a.price < b.price, a comes first
      return -1
    } else if (aPrice.gt(bPrice)) {
      // a.price > b.price, b comes first
      return 1
    } else if (aCreatedAt > bCreatedAt) {
      // a is more recently created, b comes first
      return 1
    } else if (aCreatedAt < bCreatedAt) {
      // a is older than b, a comes first
      return -1
    } else {
      // a and b are equal in price and date, keep their existing order
      return 0
    }
  })
  if (matched.length < 1) {
    result.orders.push({ type: order.type, giveAmount: order.giveAmount, giveTokenAddress: order.giveTokenAddress, takeAmount: order.takeAmount, takeTokenAddress: order.takeTokenAddress })
    return result
  }
  // fill matched orders
  for (let matchedOrder of matched) {
    if (filledTakeAmount.eq(takeAmount)) {
      break
    }
    const matchedOrderFilled = Web3Utils.toBN(matchedOrder.filled)
    const matchedOrderGiveAmount = Web3Utils.toBN(matchedOrder.giveAmount)
    const matchedOrderTakeAmount = Web3Utils.toBN(matchedOrder.takeAmount)
    const matchedOrderRemainingGiveAmount = matchedOrderGiveAmount.sub(matchedOrderFilled)
    let trade, tradeAmount
    if (remainingTakeAmount.gt(matchedOrderRemainingGiveAmount)) {
      tradeAmount = matchedOrderRemainingGiveAmount
    } else {
      tradeAmount = remainingTakeAmount
    }
    const tradeAmountEquivalentInGiveToken = calculateGiveAmount(tradeAmount, matchedOrderTakeAmount, matchedOrderGiveAmount)
    if (tradeAmountEquivalentInGiveToken.lt(takerMinimum)) {
      continue
    }
    trade = { orderHash: matchedOrder.orderHash, amount: tradeAmount, amountGive: tradeAmountEquivalentInGiveToken }
    filledTakeAmount = filledTakeAmount.add(tradeAmount)
    remainingTakeAmount = remainingTakeAmount.sub(tradeAmount)
    remainingGiveAmount = remainingGiveAmount.sub(tradeAmountEquivalentInGiveToken)
    result.trades.push(trade)
  }
  // create a rest order if there is still remaining volume
  const hasRemainingTakeAmount = filledTakeAmount.lt(takeAmount)
  const onePercentOfTotalTake = takeAmount.div(Web3Utils.toBN('100'))
  const remainingTakeAmountIsAboveOnePercent = remainingTakeAmount.gte(onePercentOfTotalTake)
  if (hasRemainingTakeAmount && remainingTakeAmountIsAboveOnePercent) {
    // re-calculate remainingGiveAmount before assigning to the rest order 
    // because it might no longer reflect the specified buying price
    // due to the matching & filling of sell orders of lower prices
    let restOrderGiveAmount = calculateGiveAmount(remainingTakeAmount, giveAmount, takeAmount)
    let restOrderTakeAmount = remainingTakeAmount
    // restOrderGiveAmount is below maker's minimum, cancel trades until it is back above
    while (restOrderGiveAmount.lt(makerMinimum)) {
      const lastTrade = result.trades.pop()
      const tradeAmount = lastTrade.amount
      const tradeAmountEquivalentInGiveToken = lastTrade.amountGive
      filledTakeAmount = filledTakeAmount.sub(tradeAmount)
      remainingTakeAmount = remainingTakeAmount.add(tradeAmount)
      remainingGiveAmount = remainingGiveAmount.add(tradeAmountEquivalentInGiveToken)
      restOrderGiveAmount = calculateGiveAmount(remainingTakeAmount, giveAmount, takeAmount)
      restOrderTakeAmount = remainingTakeAmount
    }
    const restOrder = { type: order.type, giveAmount: restOrderGiveAmount.toString(), giveTokenAddress: order.giveTokenAddress, takeAmount: restOrderTakeAmount.toString(), takeTokenAddress: order.takeTokenAddress }
    result.orders.push(restOrder)
  }
  // remove amountGive and convert amount to string before returning
  for (let trade of result.trades) {
    delete trade.amountGive
    trade.amount = trade.amount.toString()
  }
  return result
}

const calculateTakeAmount = (giveAmount, totalGiveAmount, totalTakeAmount) => {
  if (giveAmount.eq(zero) || totalGiveAmount.eq(zero) || totalTakeAmount.eq(zero)) {
    return zero
  }

  return giveAmount.mul(totalTakeAmount).div(totalGiveAmount)
}

const calculateGiveAmount = (takeAmount, totalGiveAmount, totalTakeAmount) => {
  if (takeAmount.eq(zero) || totalGiveAmount.eq(zero) || totalTakeAmount.eq(zero)) {
    return zero
  }

  return takeAmount.mul(totalGiveAmount).div(totalTakeAmount)
}

// return { price, amount, filled, total }
const getOrderVolume = (order) => {
  const takeAmount = Web3Utils.toBN(order.takeAmount)
  const giveAmount = Web3Utils.toBN(order.giveAmount)
  const price = order.type === "sell" ? (takeAmount.mul(oneEther).div(giveAmount)).toString() : (giveAmount.mul(oneEther).div(takeAmount)).toString();
  const amount = order.type === "sell" ? order.giveAmount : order.takeAmount;
  let filled
  if (order.filled) {
    filled = order.type === "sell" ? order.filled : calculateTakeAmount(Web3Utils.toBN(order.filled), giveAmount, takeAmount).toString()
  } else {
    filled = "0"
  }
  const total = order.type === "sell" ? order.takeAmount : order.giveAmount;
  return { price, amount, filled, total }
}

module.exports = {
  match,
  matchBuyOrders,
  matchSellOrders,
  calculateGiveAmount,
  calculateTakeAmount,
  getOrderVolume
}
