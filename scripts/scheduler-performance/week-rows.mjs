import {enteredMonth,validMonth} from './month-model.mjs';
// Resolves adjacent months without creating a draft merely to display a week.
export function readWeekRows(planner,index,currentMonth,currentRows,days){
 const cache=new Map([[currentMonth,currentRows]]);
 return days.map(day=>{const month=day.slice(0,7);if(!validMonth(month))return {day,row:null,store:null};if(!cache.has(month))cache.set(month,enteredMonth(month,d=>planner.context(index,d)));return {day,row:cache.get(month).find(r=>r.day===day),store:planner.context(index,day).store};});
}
