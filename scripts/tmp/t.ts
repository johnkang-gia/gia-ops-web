import { toKoreanDisplayName, matchStudent, parseChannelLabel, markIfAmbiguous } from "../../src/lib/pickupParse";
const roster = [
  { id:"1", name:"김재이", name_en:"Jay Kim", grade:"2", birth_date:"2019-05-10", class_name:"G2C" },
  { id:"2", name:"김재이", name_en:"Jay Kim", grade:"2", birth_date:"2019-08-28", class_name:"G2A" },
  { id:"3", name:"김재이", name_en:"Jay Kim", grade:"3", birth_date:"2018-03-02", class_name:"G3JA" },
];
const label = "G2_Jay Kim(190510)_Office";
console.log("parseChannelLabel:", JSON.stringify(parseChannelLabel(label)));
console.log("matchStudent(영문):", matchStudent("Jay Kim(190510)", roster, "G2", label)?.class_name);
console.log("toKorean(영문 current):", toKoreanDisplayName("Jay Kim", label, roster, ""));
console.log("toKorean(current=null):", toKoreanDisplayName(null, label, roster, ""));
console.log("toKorean(한글 current):", toKoreanDisplayName("김재이", label, roster, ""));
console.log("toKorean(라벨없음, 한글):", toKoreanDisplayName("김재이", null, roster, ""));
console.log("markIfAmbiguous:", markIfAmbiguous("김재이", roster));
