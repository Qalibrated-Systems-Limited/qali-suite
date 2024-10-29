export const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );
};

export const validatePassword = (pw) => {
  return (
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw) &&
    pw.length > 4
  );
};

export const trimAndLowerStr = (str = "") => {
  if (!str) {
    return null;
  }

  return str.trim().toLowerCase();
};

export function toTitle(str = "") {
  const modStr = trimAndLowerStr(str);
  if (!modStr) {
    return;
  }
  if (!modStr.includes(" ")) {
    return modStr.replace(modStr[0], modStr[0].toUpperCase());
  }

  let strList = modStr.split(" ");

  let titledList = [];

  for (str of strList) {
    titledList.push(str.replace(str[0], str[0].toUpperCase()));
  }

  return titledList.join(" ");
}

export function validateNumberPlate(numberPlate, countryCode) {
  const kenyaRegex =
    /^(?:[A-Z]{1}[A-Z]{2}\d{1,4}[A-Z]{1}|[A-Z]{1}[A-Z]{2} \d{1,3}[A-Z]{1})$/;
  const kenyaTukTukRegex = /^K[HMT][A-Z]{2}\s\d{3}[A-Z]$/;
  const kenya1980Regex = /^K[J-Z][A-Z]\s\d{3}$/;
  const ugandaRegex = /^[U][A-H][A-Z]\s\d{3}[A-Z]$/;
  const tanzaniaRegex = /^[A-Z]{3}\d{3}$/;

  let regex;
  if (countryCode === "KE") {
    if (
      kenyaTukTukRegex.test(numberPlate) ||
      tanzaniaRegex.test(numberPlate) ||
      numberPlate
    ) {
      return true; // Tuk Tuk plate format matches
    }
    if (kenya1980Regex.test(numberPlate)) {
      return true; // 1980 vehicle plate format matches
    }
    regex = kenyaRegex;
  } else if (countryCode === "UG") {
    regex = ugandaRegex;
  } else if (countryCode === "TZ") {
    regex = tanzaniaRegex;
  } else {
    return false; // Invalid country code
  }

  return regex.test(numberPlate);
}
